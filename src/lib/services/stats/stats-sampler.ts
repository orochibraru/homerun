import { ServiceDTO } from "$lib/dto/service-dto";
import { StatSampleDTO } from "$lib/dto/stat-sample-dto";
import { BaseScheduler } from "../cron/base-scheduler.ts";
import { DockerService } from "../docker.service.ts";
import { SystemStatsService } from "../system-stats.service.ts";

/** One in this many ticks also prunes, the same amortized shape AppLogDTO/NotificationDTO use. */
const PRUNE_EVERY_TICKS = 60;

/**
 * Writes one `stat_sample` row per minute for the host and for every
 * service with a running container, which is what the dashboard's and a
 * service's own resource graphs read back. Nothing else records history :
 * the Host Resources panel polls live values and keeps none.
 */
export class StatsSampler extends BaseScheduler {
	protected readonly label = "Stats";

	protected readonly runOnStart = true;

	#ticks = 0;

	protected async tick(): Promise<void> {
		this.#ticks += 1;

		const [host, services] = await Promise.all([
			SystemStatsService.getSystemStats(),
			ServiceDTO.listRunningWithContainers(),
		]);

		const samples = await Promise.all(
			services.map(async (svc) => {
				const sample = svc.containerId
					? await DockerService.sampleContainerStats(svc.containerId)
					: null;
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
