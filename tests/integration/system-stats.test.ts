import { beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import type { ApiClient } from "./support/client";
import { apiClient } from "./support/context";

let client: ApiClient;
beforeAll(() => {
	client = apiClient();
});

describe("system-stats", () => {
	test("returns real host CPU/RAM numbers", async () => {
		const res = await client.GET("/system-stats");
		const stats = expectOk(res.data, res.response) as {
			cpuPercent: number;
			memTotalMb: number;
			memUsedMb: number;
		};
		expect(typeof stats.cpuPercent).toBe("number");
		expect(stats.memTotalMb).toBeGreaterThan(0);
		expect(stats.memUsedMb).toBeGreaterThan(0);
	});
});
