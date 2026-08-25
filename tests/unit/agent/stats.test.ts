import { describe, expect, test } from "bun:test";
import { SystemStatsService } from "../../../packages/agent/stats";

// Real, unmocked : `df` exists on every dev/CI platform this repo targets
// (Darwin, Linux), and `nvidia-smi`'s absence (the common case) is already a
// handled, deterministic branch (gpu: null), not an error path that needs
// stubbing. This is a light integration check of the real shell-out/parsing
// logic, not a mock-everything unit test.
describe("getSystemStats", () => {
	test("returns host memory figures that are internally consistent", async () => {
		const stats = await SystemStatsService.getSystemStats();

		expect(stats.memTotalMb).toBeGreaterThan(0);
		expect(stats.memUsedMb).toBeGreaterThanOrEqual(0);
		expect(stats.memPercent).toBeGreaterThanOrEqual(0);
		expect(stats.memPercent).toBeLessThanOrEqual(100);
	});

	test("clamps cpuPercent to [0, 100]", async () => {
		const stats = await SystemStatsService.getSystemStats();
		expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
		expect(stats.cpuPercent).toBeLessThanOrEqual(100);
	});

	test("a second call (with a real CPU delta available) still stays in range", async () => {
		await SystemStatsService.getSystemStats();
		const stats = await SystemStatsService.getSystemStats();
		expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
		expect(stats.cpuPercent).toBeLessThanOrEqual(100);
	});

	test("disk stats are either a consistent triple or all null", async () => {
		const stats = await SystemStatsService.getSystemStats();
		if (stats.diskTotalMb === null) {
			expect(stats.diskUsedMb).toBeNull();
			expect(stats.diskPercent).toBeNull();
		} else {
			expect(stats.diskTotalMb).toBeGreaterThan(0);
			expect(stats.diskUsedMb).toBeGreaterThanOrEqual(0);
			expect(stats.diskPercent).toBeGreaterThanOrEqual(0);
			expect(stats.diskPercent).toBeLessThanOrEqual(100);
		}
	});

	test("gpu is null, or a well-shaped reading when nvidia-smi is present", async () => {
		const stats = await SystemStatsService.getSystemStats();
		if (stats.gpu !== null) {
			expect(typeof stats.gpu.name).toBe("string");
			expect(stats.gpu.memTotalMb).toBeGreaterThanOrEqual(0);
			expect(stats.gpu.memUsedMb).toBeGreaterThanOrEqual(0);
			expect(stats.gpu.utilizationPercent).toBeGreaterThanOrEqual(0);
		} else {
			expect(stats.gpu).toBeNull();
		}
	});
});
