import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { DockerService } from "../docker.service.ts";
import { ServiceLifecycleService } from "../service-lifecycle.service.ts";

const logger = new Logger("Backup");

const PRE_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const OUTPUT_TAIL_CHARS = 2000;

export const VOLUME_HELPER_IMAGE = "alpine";
export const VOLUME_HELPER_TAG = "3";
export const VOLUME_HELPER_MOUNT_PATH = "/homerun-backup-source";

/** The last `OUTPUT_TAIL_CHARS` characters of a command's output, trimmed : a failure's useful part is at the end. */
export function outputTail(output: string): string {
	const trimmed = output.trim();
	return trimmed.length > OUTPUT_TAIL_CHARS
		? `...${trimmed.slice(-OUTPUT_TAIL_CHARS)}`
		: trimmed;
}

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

export interface StopAroundWorkHooks<TService> {
	onStartFailure: (service: TService, reason: unknown) => void;
	start: (service: TService) => Promise<void>;
	stop: (service: TService) => Promise<void>;
}

/**
 * Stops each of `services` one at a time, runs `work`, then starts every
 * service it managed to stop again, whether `work` succeeded or threw. A
 * failed start is reported through `hooks.onStartFailure` rather than thrown,
 * since the work itself already happened.
 *
 * @throws Whatever `work` throws, or the first stop error (after starting the
 *   services stopped before it again, without running `work`).
 */
export async function stopAroundWork<TService, TResult>(
	services: TService[],
	hooks: StopAroundWorkHooks<TService>,
	work: () => Promise<TResult>,
): Promise<TResult> {
	const stopped: TService[] = [];
	try {
		for (const service of services) {
			// oxlint-disable-next-line no-await-in-loop -- stopped one at a time so a failure knows exactly which ones to start again
			await hooks.stop(service);
			stopped.push(service);
		}
		return await work();
	} finally {
		const results = await Promise.allSettled(
			stopped.map((service) => hooks.start(service)),
		);
		results.forEach((result, index) => {
			const service = stopped[index];
			if (result.status === "rejected" && service !== undefined) {
				hooks.onStartFailure(service, result.reason);
			}
		});
	}
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
	 * Runs the volume's `backupPreCommand` through `/bin/sh -c` inside its
	 * picked service's container, or the first running service using the
	 * volume when none is picked. Does nothing when no command is set.
	 *
	 * @throws When there's no running service to run it in, when the command
	 *   exits non-zero, or when it runs past 15 minutes.
	 */
	async runPreCommand(volume: StorageVolumeDTO): Promise<void> {
		const command = volume.backupPreCommand?.trim();
		if (!command) {
			return;
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
		logger.info(
			`Pre-backup command started: volume=${volume.id} service=${service.id}`,
		);
		const result = await DockerService.execInContainer(
			containerId,
			["/bin/sh", "-c", command],
			PRE_COMMAND_TIMEOUT_MS,
		);
		if (result.timedOut) {
			throw new Error(
				`The pre-backup command in "${service.name}" was still running after 15 minutes.`,
			);
		}
		if (result.exitCode !== 0) {
			const tail = outputTail(result.output);
			throw new Error(
				`The pre-backup command in "${service.name}" exited ${result.exitCode}${tail ? `: ${tail}` : "."}`,
			);
		}
	}

	/**
	 * Stops every running service in `services`, runs `work`, then starts
	 * them again whether or not `work` succeeded. A service that fails to
	 * start again is logged rather than failing the run, since the backup or
	 * restore itself already happened.
	 *
	 * @throws Whatever `work` throws, or the stop error when a service can't
	 *   be stopped (the ones already stopped are started again first).
	 */
	async whileStopped<T>(
		services: ServiceDTO[],
		work: () => Promise<T>,
	): Promise<T> {
		return await stopAroundWork(
			await this.runningOnly(services),
			{
				onStartFailure: (service, reason) =>
					logger.error(
						`Couldn't start "${service.name}" again after a backup or restore`,
						reason,
					),
				start: (service) => ServiceLifecycleService.startService(service),
				stop: async (service) => {
					await ServiceLifecycleService.stopService(service);
					logger.info(`Stopped for a backup or restore: ${service.name}`);
				},
			},
			work,
		);
	}

	/**
	 * Deletes everything inside the volume through a short-lived helper
	 * container with it mounted, one path for both volume kinds.
	 *
	 * @throws When the helper exits non-zero.
	 */
	async wipe(volume: StorageVolumeDTO): Promise<void> {
		const result = await DockerService.runOneOff({
			binds: [`${volume.source}:${VOLUME_HELPER_MOUNT_PATH}`],
			cmd: ["find", VOLUME_HELPER_MOUNT_PATH, "-mindepth", "1", "-delete"],
			image: VOLUME_HELPER_IMAGE,
			tag: VOLUME_HELPER_TAG,
		});
		if (result.exitCode !== 0) {
			const tail = outputTail(result.stderr.toString("utf8"));
			throw new Error(
				`Couldn't wipe "${volume.name}" before restoring (exit ${result.exitCode})${tail ? `: ${tail}` : "."}`,
			);
		}
		logger.info(`Volume wiped before restore: volume=${volume.id}`);
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
