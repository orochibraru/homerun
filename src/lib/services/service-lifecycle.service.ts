import { config } from "$lib/config";
import { ServiceDependencyDTO } from "$lib/dto/service-dependency-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceGitDTO } from "$lib/dto/service-git-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import { serviceHostnames } from "$lib/service-domains";
import type { ContainerStatus } from "$lib/types";
import { deleteDns } from "./dns.service.ts";
import {
	tryRemoveWorkload,
	WorkloadDetachError,
} from "./docker/workload-removal.ts";
import { DockerService } from "./docker.service.ts";
import { GitWebhookService } from "./git-webhook.service.ts";

const logger = new Logger("ServiceLifecycle");

/**
 * Container/swarm-service lifecycle operations, keyed off a `ServiceDTO`
 * rather than a raw container id where the operation needs to branch on
 * swarm mode. The bare `start`/`stop`/`restart`/`remove`/`status`/
 * `streamLogs` methods are thin `DockerService` passthroughs for callers
 * that already have a container id and don't need the swarm branching.
 */
class ServiceLifecycleServiceClass {
	/** Starts a container by id. */
	start(containerId: string): Promise<void> {
		return DockerService.startContainer(containerId);
	}

	/** Stops a container by id. */
	stop(containerId: string): Promise<void> {
		return DockerService.stopContainer(containerId);
	}

	/** Restarts a container by id. */
	restart(containerId: string): Promise<void> {
		return DockerService.restartContainer(containerId);
	}

	/** Force-removes a container by id. */
	remove(containerId: string): Promise<void> {
		return DockerService.removeContainer(containerId, { force: true });
	}

	/** The container's current status, by id. */
	status(containerId: string): Promise<ContainerStatus> {
		return DockerService.inspectStatus(containerId);
	}

	/** A live, following log stream for a container, capped to the last 200 lines of backlog. */
	streamLogs(containerId: string): Promise<ReadableStream<Uint8Array>> {
		return DockerService.streamLogs(containerId, { follow: true, tail: 200 });
	}

	/**
	 * Starts a service: first each service it depends on
	 * (`ServiceDependencyDTO`) that is deployed but not running, recursively,
	 * then scales its swarm service up (to its configured replica count) or
	 * starts its single container, and persists `desiredState: "running"`.
	 *
	 * @throws When the service has no swarm service and no container yet, or a
	 * dependency fails to start.
	 */
	startService(svc: ServiceDTO): Promise<void> {
		return this.#startWithDependencies(svc, new Set());
	}

	/**
	 * `startService`'s recursion: `visited` holds every service already
	 * handled in this run, so a dependency shared by two branches starts once
	 * and a cycle ends where it would loop.
	 *
	 * @throws When the service has no swarm service and no container yet, or a
	 * dependency fails to start.
	 */
	async #startWithDependencies(
		svc: ServiceDTO,
		visited: Set<string>,
	): Promise<void> {
		visited.add(svc.id);
		for (const id of await ServiceDependencyDTO.listForService(svc.id)) {
			if (visited.has(id)) {
				continue;
			}
			// oxlint-disable-next-line no-await-in-loop -- dependencies start one after another, each before the service that needs it
			const dep = await ServiceDTO.get(id);
			// oxlint-disable-next-line no-await-in-loop -- see above
			if (!dep || (await this.#isRunningOrUndeployed(dep))) {
				visited.add(id);
				continue;
			}
			// oxlint-disable-next-line no-await-in-loop -- see above
			await this.#startWithDependencies(dep, visited).catch((error) => {
				throw new Error(
					`Couldn't start ${dep.name}, which ${svc.name} depends on: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
		}
		if (svc.swarmServiceId) {
			await DockerService.scaleSwarmService(
				svc.swarmServiceId,
				svc.replicas || 1,
			);
		} else {
			await this.start(this.#requireContainer(svc));
		}
		await svc.update({ desiredState: "running" });
	}

	/**
	 * Stops a service: persists `desiredState: "stopped"` first, so a status
	 * sync during a slow stop already knows the exit was asked for, then scales
	 * its swarm service to 0 replicas or stops its single container.
	 *
	 * @throws When the service has no swarm service and no container yet.
	 */
	async stopService(svc: ServiceDTO): Promise<void> {
		if (!svc.swarmServiceId) {
			this.#requireContainer(svc);
		}
		await svc.update({ desiredState: "stopped" });
		if (svc.swarmServiceId) {
			await DockerService.scaleSwarmService(svc.swarmServiceId, 0);
		} else {
			await this.stop(this.#requireContainer(svc));
		}
	}

	/**
	 * Restarts a service's swarm service or single container.
	 *
	 * @throws When the service has no swarm service and no container yet.
	 */
	async restartService(svc: ServiceDTO): Promise<void> {
		if (svc.swarmServiceId) {
			await DockerService.restartSwarmService(svc.swarmServiceId);
			return;
		}
		await this.restart(this.#requireContainer(svc));
	}

	/**
	 * Kills a standalone service's container outright (SIGKILL, no grace
	 * period) and persists `desiredState: "stopped"` first, same as a stop.
	 *
	 * @throws When the service runs in swarm mode, or has no container yet.
	 */
	async killService(svc: ServiceDTO): Promise<void> {
		if (svc.swarmServiceId) {
			throw new Error("A swarm service can't be killed, stop it instead.");
		}
		const containerId = this.#requireContainer(svc);
		await svc.update({ desiredState: "stopped" });
		await DockerService.killContainer(containerId);
	}

	/**
	 * Pulls a registry-sourced service's image and tag onto this host with its
	 * registry credentials, without redeploying it.
	 *
	 * @returns Whether the pull brought a different image than the one already
	 * on this host.
	 * @throws When the service builds from a git repo.
	 */
	async pullServiceImage(svc: ServiceDTO): Promise<{ changed: boolean }> {
		if (svc.buildSource === "git") {
			throw new Error("This service builds from git, rebuild it instead.");
		}
		const ref = `${svc.image}:${svc.tag}`;
		const before = await DockerService.localImageId(ref);
		await DockerService.pullImage({
			auth: DockerService.buildAuthConfig(svc),
			image: svc.image,
			tag: svc.tag,
		});
		return { changed: (await DockerService.localImageId(ref)) !== before };
	}

	/**
	 * Deletes a service: removes its pull request previews and release
	 * channel canary first, then its swarm service or container, its git
	 * webhook and its row. A workload Docker reports as already gone counts as
	 * removed.
	 *
	 * @param options.force Deletes the row even when the workload couldn't be
	 * removed, for a daemon that will never answer for it again.
	 * @throws {WorkloadDetachError} When the workload couldn't be removed and
	 * `force` isn't set; nothing is deleted then.
	 */
	async deleteService(
		svc: ServiceDTO,
		options: { force?: boolean } = {},
	): Promise<void> {
		for (const preview of await ServiceGitDTO.listChildren(svc.id)) {
			// oxlint-disable-next-line no-await-in-loop -- each preview's workload removal can fail the whole delete
			await this.deleteService(preview, options);
		}
		const failure = await this.#detachWorkload(svc);
		if (failure && !options.force) {
			throw new WorkloadDetachError(
				`Couldn't remove the ${svc.swarmServiceId ? "swarm service" : "container"} for "${svc.name}": ${failure}. Nothing was deleted.`,
			);
		}
		const stack = svc.stackId ? await StackDTO.get(svc.stackId) : null;
		await this.#cleanUpOutside(svc, stack?.slug ?? null);
		await svc.delete();
	}

	/**
	 * Deletes a stack and every service in it (see `StackDTO.cascadeDelete`
	 * for the workload rules and `force`), then removes what each member left
	 * outside Homerun: its push webhook and DNS records.
	 *
	 * @throws WorkloadDetachError When a member's workload can't be removed and
	 * `force` isn't set; nothing is deleted then.
	 */
	async deleteStack(
		stack: StackDTO,
		options: { force?: boolean } = {},
	): Promise<void> {
		const members = await ServiceDTO.listByStack(stack.id);
		await stack.cascadeDelete(options);
		await Promise.all(
			members.map((svc) => this.#cleanUpOutside(svc, stack.slug)),
		);
	}

	/**
	 * Removes a deleted service's footprint outside Homerun: the git push
	 * webhook on its provider, and the DNS records for its hostname and custom
	 * domain when it was publicly routed. Best effort, never throws.
	 */
	async #cleanUpOutside(
		svc: ServiceDTO,
		stackSlug: string | null,
	): Promise<void> {
		await GitWebhookService.remove(svc);
		if (!svc.dnsResolvable) {
			return;
		}
		await deleteDns(
			serviceHostnames(svc.toJSON(), stackSlug, config.baseDomain),
		).catch((err) => {
			logger.warn(`Couldn't remove DNS records for service=${svc.id}`, err);
		});
	}

	/** Whether a dependency needs no starting: it's already running, or has never been deployed so there's nothing to start. */
	async #isRunningOrUndeployed(svc: ServiceDTO): Promise<boolean> {
		if (svc.swarmServiceId) {
			return svc.currentStatus === "running";
		}
		if (!svc.containerId) {
			return true;
		}
		return (
			(await this.status(svc.containerId).catch(() => "missing")) === "running"
		);
	}

	/**
	 * @throws When the service has never been deployed (no container id).
	 * @returns The service's container id.
	 */
	#requireContainer(svc: ServiceDTO): string {
		if (!svc.containerId) {
			throw new Error("This service hasn't been deployed yet.");
		}
		return svc.containerId;
	}

	/**
	 * Removes a service's swarm service or container, if it has one.
	 *
	 * @returns Null when it's gone (or there was nothing to remove), else why the
	 * removal failed.
	 */
	#detachWorkload(svc: ServiceDTO): Promise<string | null> {
		const { containerId, swarmServiceId } = svc;
		if (swarmServiceId) {
			return tryRemoveWorkload(() =>
				DockerService.removeSwarmService(swarmServiceId),
			);
		}
		if (containerId) {
			return tryRemoveWorkload(() => this.remove(containerId));
		}
		return Promise.resolve(null);
	}
}

export const ServiceLifecycleService = new ServiceLifecycleServiceClass();
