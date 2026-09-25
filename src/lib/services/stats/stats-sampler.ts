import { ServiceDTO } from "$lib/dto/service-dto";
import { StatSampleDTO } from "$lib/dto/stat-sample-dto";
import { CapacityService } from "../capacity.service.ts";
import { BaseScheduler } from "../cron/base-scheduler.ts";
import type { ContainerSample } from "../docker/containers.ts";
import { sumReplicaSamples } from "../docker/swarm-replicas.ts";
import { DockerService } from "../docker.service.ts";
import { SystemStatsService } from "../system-stats.service.ts";

/** One in this many ticks also prunes, the same amortized shape AppLogDTO/NotificationDTO use. */
const PRUNE_EVERY_TICKS = 60;

/**
 * Writes one `stat_sample` row per minute for the host and for every
 * service with a running container (or, in swarm mode, the sum over its
 * replicas running on this host), which is what the dashboard's and a
 * service's own resource graphs read back. Nothing else records history :
 * the Host Resources panel polls live values and keeps none. Each host
 * sample is also checked against the resource thresholds (`CapacityService`).
 */
export class StatsSampler extends BaseScheduler {
	protected readonly label = "Stats";

	protected readonly runOnStart = true;

	#ticks = 0;

	/** One service's current sample : its container's, or the sum over its local swarm replicas. Null when nothing of it runs here. */
	async #sampleService(svc: ServiceDTO): Promise<ContainerSample | null> {
		if (svc.containerId) {
			return await DockerService.sampleContainerStats(svc.containerId);
		}
		if (svc.swarmServiceId) {
			const replicas = await DockerService.listSwarmReplicas(
				svc.swarmServiceId,
			);
			return sumReplicaSamples(replicas.map((replica) => replica.sample));
		}
		return null;
	}

	/**
	 * Samples host stats, every running service's container stats and every
	 * swarm service's local replicas in parallel and writes them as one batch of `stat_sample` rows
	 * (`StatSampleDTO.recordMany`). Every `PRUNE_EVERY_TICKS`th tick also
	 * prunes old samples (`StatSampleDTO.prune`).
	 */
	protected async tick(): Promise<void> {
		this.#ticks += 1;

		const [host, services] = await Promise.all([
			SystemStatsService.getSystemStats(),
			ServiceDTO.listRunningWithContainers(),
		]);
		await CapacityService.evaluate(host).catch((err) => {
			this.logger.warn("Couldn't check the resource thresholds", err);
		});

		const samples = await Promise.all(
			services.map(async (svc) => {
				const sample = await this.#sampleService(svc);
				return sample
					? {
							cpuPercent: sample.cpuPercent,
							memLimitMb: sample.memLimitMb,
							memUsedMb: sample.memUsedMb,
							netRxBytes: sample.netRxBytes,
							netTxBytes: sample.netTxBytes,
							serviceId: svc.id,
						}
					: null;
			}),
		);

		await StatSampleDTO.recordMany([
			{
				cpuPercent: host.cpuPercent,
				diskUsedGb: host.diskUsedGb,
				memLimitMb: host.memTotalMb,
				memUsedMb: host.memUsedMb,
				serviceId: null,
			},
			...samples.filter((sample) => sample !== null),
		]);

		if (this.#ticks % PRUNE_EVERY_TICKS === 0) {
			await StatSampleDTO.prune();
		}
	}
}
