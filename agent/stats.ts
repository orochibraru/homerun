import { spawn } from "node:child_process";
import os from "node:os";

/**
 * Self-contained port of the main app's `SystemStatsService` : not imported
 * from there since the agent is a separately-deployed binary with no access
 * to the main app's source tree at runtime. Keep the two in sync by hand if
 * one changes; they're small and unlikely to drift silently.
 */
export interface SystemStats {
	cpuPercent: number;
	memTotalMb: number;
	memUsedMb: number;
	memPercent: number;
	diskTotalMb: number | null;
	diskUsedMb: number | null;
	diskPercent: number | null;
	gpu: {
		name: string;
		memTotalMb: number;
		memUsedMb: number;
		utilizationPercent: number;
	} | null;
}

interface CpuSample {
	idle: number;
	total: number;
}

let lastCpuSample: CpuSample | null = null;

function sampleCpu(): CpuSample {
	let idle = 0;
	let total = 0;
	for (const cpu of os.cpus()) {
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

function run(cmd: string, args: string[]): Promise<string | null> {
	return new Promise((resolve) => {
		try {
			const child = spawn(cmd, args);
			let out = "";
			child.stdout.on("data", (d) => {
				out += d.toString();
			});
			child.on("error", () => resolve(null));
			child.on("close", (code) => resolve(code === 0 ? out : null));
		} catch {
			resolve(null);
		}
	});
}

async function diskStats(): Promise<{
	totalMb: number;
	usedMb: number;
	percent: number;
} | null> {
	const out = await run("df", ["-Pk", "."]);
	if (!out) {
		return null;
	}
	const line = out.trim().split("\n").at(-1);
	const parts = line?.trim().split(/\s+/);
	if (!parts || parts.length < 5) {
		return null;
	}
	const totalKb = Number.parseInt(parts[1], 10);
	const usedKb = Number.parseInt(parts[2], 10);
	if (!(Number.isFinite(totalKb) && Number.isFinite(usedKb)) || totalKb === 0) {
		return null;
	}
	return {
		percent: Math.round((usedKb / totalKb) * 100),
		totalMb: Math.round(totalKb / 1024),
		usedMb: Math.round(usedKb / 1024),
	};
}

async function gpuStats(): Promise<SystemStats["gpu"]> {
	const out = await run("nvidia-smi", [
		"--query-gpu=name,memory.total,memory.used,utilization.gpu",
		"--format=csv,noheader,nounits",
	]);
	if (!out) {
		return null;
	}
	const [name, memTotal, memUsed, util] = out
		.trim()
		.split(",")
		.map((s) => s.trim());
	if (!name) {
		return null;
	}
	return {
		memTotalMb: Number.parseInt(memTotal, 10) || 0,
		memUsedMb: Number.parseInt(memUsed, 10) || 0,
		name,
		utilizationPercent: Number.parseInt(util, 10) || 0,
	};
}

export async function getSystemStats(): Promise<SystemStats> {
	const sample = sampleCpu();
	let cpuPercent = 0;
	if (lastCpuSample) {
		const idleDelta = sample.idle - lastCpuSample.idle;
		const totalDelta = sample.total - lastCpuSample.total;
		cpuPercent =
			totalDelta > 0 ? Math.round(100 * (1 - idleDelta / totalDelta)) : 0;
	}
	lastCpuSample = sample;

	const memTotalMb = Math.round(os.totalmem() / 1024 / 1024);
	const memFreeMb = Math.round(os.freemem() / 1024 / 1024);
	const memUsedMb = memTotalMb - memFreeMb;

	const [disk, gpu] = await Promise.all([diskStats(), gpuStats()]);

	return {
		cpuPercent: Math.min(100, Math.max(0, cpuPercent)),
		diskPercent: disk?.percent ?? null,
		diskTotalMb: disk?.totalMb ?? null,
		diskUsedMb: disk?.usedMb ?? null,
		gpu,
		memPercent: memTotalMb > 0 ? Math.round((memUsedMb / memTotalMb) * 100) : 0,
		memTotalMb,
		memUsedMb,
	};
}
