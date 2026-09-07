import type { ServiceDTO } from "$lib/dto/service-dto";
import type { ContainerStatus } from "$lib/types";
import { DockerService } from "./docker.service.ts";

class ServiceLifecycleServiceClass {
	start(containerId: string): Promise<void> {
		return DockerService.startContainer(containerId);
	}

	stop(containerId: string): Promise<void> {
		return DockerService.stopContainer(containerId);
	}

	restart(containerId: string): Promise<void> {
		return DockerService.restartContainer(containerId);
	}

	remove(containerId: string): Promise<void> {
		return DockerService.removeContainer(containerId, { force: true });
	}

	status(containerId: string): Promise<ContainerStatus> {
		return DockerService.inspectStatus(containerId);
	}

	streamLogs(containerId: string): Promise<ReadableStream<Uint8Array>> {
		return DockerService.streamLogs(containerId, { follow: true, tail: 200 });
	}

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

	async stopService(svc: ServiceDTO): Promise<void> {
		if (svc.swarmServiceId) {
			await DockerService.scaleSwarmService(svc.swarmServiceId, 0);
		} else {
			await this.stop(this.#requireContainer(svc));
		}
		await svc.update({ desiredState: "stopped" });
	}

	async restartService(svc: ServiceDTO): Promise<void> {
		if (svc.swarmServiceId) {
			await DockerService.restartSwarmService(svc.swarmServiceId);
			return;
		}
		await this.restart(this.#requireContainer(svc));
	}

	async deleteService(svc: ServiceDTO): Promise<void> {
		await this.#detachWorkload(svc);
		await svc.delete();
	}

	#requireContainer(svc: ServiceDTO): string {
		if (!svc.containerId) {
			throw new Error("This service hasn't been deployed yet.");
		}
		return svc.containerId;
	}

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
