import { WorkerClient } from "$lib/server/worker-client";

export interface SystemStats {
	cpuPercent: number;
	diskTotalGb: number | null;
	diskUsedGb: number | null;
	gpu: GpuStats | null;
	memTotalMb: number;
	memUsedMb: number;
}

export interface GpuStats {
	memTotalMb: number;
	memUsedMb: number;
	name: string;
	utilizationPercent: number;
}

interface HostStats {
	cpuPercent: number;
	diskPercent: number | null;
	diskTotalMb: number | null;
	diskUsedMb: number | null;
	gpu: GpuStats | null;
	memPercent: number;
	memTotalMb: number;
	memUsedMb: number;
}

const MB_PER_GB = 1024;

/** Host-level (not per-container) CPU/RAM/disk/GPU stats for the dashboard. */
class SystemStatsServiceClass {
	/**
	 * Current host CPU/RAM/disk/GPU snapshot, run for the dashboard's Host
	 * Resources panel and the stats sampler. Read from the Go worker, which is
	 * the process on the real Docker host : the app may be a container, and its
	 * own `os`/`df` readings would describe that container's limits rather than
	 * the machine's. CPU% is a delta against the worker's previous sample, so
	 * the first call after the worker starts reports 0.
	 */
	async getSystemStats(): Promise<SystemStats> {
		const host = await WorkerClient.get<HostStats>("/v1/host/stats");
		return {
			cpuPercent: host.cpuPercent,
			diskTotalGb:
				host.diskTotalMb === null ? null : host.diskTotalMb / MB_PER_GB,
			diskUsedGb: host.diskUsedMb === null ? null : host.diskUsedMb / MB_PER_GB,
			gpu: host.gpu,
			memTotalMb: host.memTotalMb,
			memUsedMb: host.memUsedMb,
		};
	}
}

export const SystemStatsService = new SystemStatsServiceClass();
