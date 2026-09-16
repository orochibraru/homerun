import type { ServiceDTO } from "$lib/dto/service-dto";
import type { ContainerStatus } from "$lib/types";
import { DockerService } from "./docker.service.ts";
import { GitWebhookService } from "./git-webhook.service.ts";

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
	 * Deletes a service: best-effort detaches its swarm service/container
	 * (a failure there doesn't stop the delete), then deletes the row.
	 */
	async deleteService(svc: ServiceDTO): Promise<void> {
		await GitWebhookService.remove(svc);
		await this.#detachWorkload(svc);
		await svc.delete();
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
	 * Removes a service's swarm service or container, swallowing any
	 * failure rather than throwing.
	 *
	 * @returns Whether the removal succeeded.
	 */
	async #detachWorkload(svc: ServiceDTO): Promise<boolean> {
		try {
			if (svc.swarmServiceId) {
				await DockerService.removeSwarmService(svc.swarmServiceId);
			} else if (svc.containerId) {
				await this.remove(svc.containerId);
			}
			return true;
		} catch {
			return false;
		}
	}
}

export const ServiceLifecycleService = new ServiceLifecycleServiceClass();
