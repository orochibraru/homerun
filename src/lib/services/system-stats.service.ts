import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { Logger } from "$lib/logger";

const logger = new Logger("SystemStats");
const execFileAsync = promisify(execFile);

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

const DF_LINE_RE = /\s+/;

async function getDiskUsage(): Promise<{
	totalGb: number | null;
	usedGb: number | null;
}> {
	try {
		// -P for POSIX-standard single-line-per-filesystem output, -k for
		// kilobyte blocks (portable across macOS/Linux, unlike -h's units).
		const { stdout } = await execFileAsync("df", ["-Pk", "."]);
		const lines = stdout.trim().split("\n");
		const dataLine = lines.at(-1);
		if (!dataLine) {
			return { totalGb: null, usedGb: null };
		}
		const parts = dataLine.trim().split(DF_LINE_RE);
		const totalKb = Number(parts[1]);
		const usedKb = Number(parts[2]);
		if (!(Number.isFinite(totalKb) && Number.isFinite(usedKb))) {
			return { totalGb: null, usedGb: null };
		}
		return { totalGb: totalKb / 1024 / 1024, usedGb: usedKb / 1024 / 1024 };
	} catch (err) {
		logger.warn("Disk usage check failed", err);
		return { totalGb: null, usedGb: null };
	}
}

const CSV_SEPARATOR_RE = /,\s*/;

/** Best-effort : most hosts running this app have no GPU, that's the expected/common case, not an error. */
async function getGpuStats(): Promise<GpuStats | null> {
	try {
		const { stdout } = await execFileAsync("nvidia-smi", [
			"--query-gpu=name,utilization.gpu,memory.used,memory.total",
			"--format=csv,noheader,nounits",
		]);
		const [line] = stdout.trim().split("\n");
		if (!line) {
			return null;
		}
		const [name, util, memUsed, memTotal] = line.split(CSV_SEPARATOR_RE);
		return {
			memTotalMb: Number(memTotal),
			memUsedMb: Number(memUsed),
			name: name.trim(),
			utilizationPercent: Number(util),
		};
	} catch {
		// No nvidia-smi on PATH : no GPU, or a non-NVIDIA one. Not an error.
		return null;
	}
}

interface CpuSample {
	idle: number;
	total: number;
}

/** Host-level (not per-container) CPU/RAM/disk/GPU stats for the dashboard. */
class SystemStatsServiceClass {
	// os.cpus() returns cumulative counters since boot : CPU% needs a delta
	// between two samples. Real instance state (rather than the module-scope
	// `let` this used to be) : the singleton this class is exported as below
	// lives for the app's lifetime, so behavior is identical — repeated
	// calls (e.g. a polling dashboard) diff against the previous call
	// instead of each blocking for a fresh sample window — this is just the
	// OOP-correct place for that state to live.
	#lastCpuSample: CpuSample | null = null;

	#sampleCpuTimes(): CpuSample {
		const cpus = os.cpus();
		let idle = 0;
		let total = 0;
		for (const cpu of cpus) {
			idle += cpu.times.idle;
			total +=
				cpu.times.user +
				cpu.times.nice +
				cpu.times.sys +
				cpu.times.idle +
				cpu.times.irq;
		}
		return { idle, total };
	}

	#getCpuPercent(): number {
		const sample = this.#sampleCpuTimes();
		if (!this.#lastCpuSample) {
			this.#lastCpuSample = sample;
			return 0;
		}
		const idleDelta = sample.idle - this.#lastCpuSample.idle;
		const totalDelta = sample.total - this.#lastCpuSample.total;
		this.#lastCpuSample = sample;
		if (totalDelta <= 0) {
			return 0;
		}
		return Math.max(0, Math.min(100, 100 * (1 - idleDelta / totalDelta)));
	}

	async getSystemStats(): Promise<SystemStats> {
		const [disk, gpu] = await Promise.all([getDiskUsage(), getGpuStats()]);
		const memTotalMb = os.totalmem() / 1024 / 1024;
		const memUsedMb = memTotalMb - os.freemem() / 1024 / 1024;

		return {
			cpuPercent: this.#getCpuPercent(),
			diskTotalGb: disk.totalGb,
			diskUsedGb: disk.usedGb,
			gpu,
			memTotalMb,
			memUsedMb,
		};
	}
}

export const SystemStatsService = new SystemStatsServiceClass();
