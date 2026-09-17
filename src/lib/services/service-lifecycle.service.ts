import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import type { ContainerStatus } from "$lib/types";
import { deleteDns, serviceHostname } from "./dns.service.ts";
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
	 * Starts a service: scales its swarm service up (to its configured
	 * replica count) or starts its single container, then persists
	 * `desiredState: "running"`.
	 *
	 * @throws When the service has no swarm service and no container yet.
	 */
	async startService(svc: ServiceDTO): Promise<void> {
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
	 * Stops a service: scales its swarm service to 0 replicas or stops its
	 * single container, then persists `desiredState: "stopped"`.
	 *
	 * @throws When the service has no swarm service and no container yet.
	 */
	async stopService(svc: ServiceDTO): Promise<void> {
		if (svc.swarmServiceId) {
			await DockerService.scaleSwarmService(svc.swarmServiceId, 0);
		} else {
			await this.stop(this.#requireContainer(svc));
		}
		await svc.update({ desiredState: "stopped" });
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
	 * Deletes a service: removes its swarm service or container, then its git
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
		const failure = await this.#detachWorkload(svc);
		if (failure && !options.force) {
			throw new WorkloadDetachError(
				`Couldn't remove the ${svc.swarmServiceId ? "swarm service" : "container"} for "${svc.name}": ${failure}. Nothing was deleted.`,
			);
		}
		const stack = svc.stackId
			? await StackDTO.get(svc.stackId, svc.userId)
			: null;
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
		const members = await ServiceDTO.listByStack(stack.id, stack.userId);
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
		await deleteDns([
			serviceHostname(svc.slug, stackSlug),
			...(svc.customDomain ? [svc.customDomain] : []),
		]).catch((err) => {
			logger.warn(`Couldn't remove DNS records for service=${svc.id}`, err);
		});
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
