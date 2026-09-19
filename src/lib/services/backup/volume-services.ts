import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { DockerService } from "../docker.service.ts";

export const VOLUME_HELPER_IMAGE = "alpine";
export const VOLUME_HELPER_TAG = "3";
export const VOLUME_HELPER_MOUNT_PATH = "/homerun-backup-source";

export interface StopTarget {
	containerId: string | null;
	id: string;
	name: string;
	replicas: number;
	swarmServiceId: string | null;
}

export interface PreCommandTarget {
	command: string;
	containerId: string;
	serviceName: string;
}

/**
 * What a backup or restore does to the services mounting a volume around the
 * actual tar or unpack : running a pre-backup command inside one of them,
 * stopping the running ones for the duration and starting them again, and
 * wiping the volume before a restore.
 */
class VolumeServicesClass {
	/** Every service the volume is mounted into. */
	async servicesUsing(volume: StorageVolumeDTO): Promise<ServiceDTO[]> {
		const ids = await ServiceVolumeDTO.serviceIdsForVolume(volume.id);
		const services = await Promise.all(ids.map((id) => ServiceDTO.get(id)));
		return services.filter((service): service is ServiceDTO =>
			Boolean(service),
		);
	}

	/** The subset of `services` whose container or swarm service is running right now, per a live Docker check. */
	async runningOnly(services: ServiceDTO[]): Promise<ServiceDTO[]> {
		const statuses = await Promise.all(
			services.map((service) =>
				DockerService.syncServiceStatus(service.id).catch(() => "missing"),
			),
		);
		return services.filter((_, index) => statuses[index] === "running");
	}

	/** The running services among `services`, as the Go worker stops and starts them around a backup or restore. */
	async stopTargets(services: ServiceDTO[]): Promise<StopTarget[]> {
		return (await this.runningOnly(services)).map((service) => ({
			containerId: service.containerId,
			id: service.id,
			name: service.name,
			replicas: service.replicas,
			swarmServiceId: service.swarmServiceId,
		}));
	}

	/**
	 * Where the volume's `backupPreCommand` runs: its picked service's
	 * container, or the first running service using the volume. Null when no
	 * command is set.
	 *
	 * @throws When there's no running service or container to run it in.
	 */
	async preCommandTarget(
		volume: StorageVolumeDTO,
	): Promise<PreCommandTarget | null> {
		const command = volume.backupPreCommand?.trim();
		if (!command) {
			return null;
		}
		const service = await this.#preCommandService(volume);
		const containerId = service.swarmServiceId
			? await DockerService.getRunningTaskContainerId(service.swarmServiceId)
			: service.containerId;
		if (!containerId) {
			throw new Error(
				`"${service.name}" has no running container to run the pre-backup command in.`,
			);
		}
		return { command, containerId, serviceName: service.name };
	}

	/**
	 * The service a pre-backup command runs in : the volume's picked one, or
	 * the first running service using the volume.
	 *
	 * @throws When the picked service is gone or none is running.
	 */
	async #preCommandService(volume: StorageVolumeDTO): Promise<ServiceDTO> {
		if (volume.backupPreCommandServiceId) {
			const picked = await ServiceDTO.get(volume.backupPreCommandServiceId);
			if (!picked) {
				throw new Error(
					"The service picked to run the pre-backup command no longer exists.",
				);
			}
			return picked;
		}
		const [first] = await this.runningOnly(await this.servicesUsing(volume));
		if (!first) {
			throw new Error(
				"No running service uses this volume, so there's nowhere to run the pre-backup command.",
			);
		}
		return first;
	}
}

export const VolumeServices = new VolumeServicesClass();
