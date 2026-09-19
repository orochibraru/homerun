import { describe, expect, test } from "bun:test";
import process from "node:process";
import {
	listeningHealthcheck,
	listeningScript,
} from "../../../src/lib/services/docker/readiness";

describe("generated listening check", () => {
	test("matches the port as /proc/net/tcp writes it", () => {
		expect(listeningScript(80)).toContain("*:0050)");
		expect(listeningScript(8080)).toContain("*:1F90)");
		expect(listeningScript(65_535)).toContain("*:FFFF)");
	});

	test("probes every second while starting, for as long as a rollout waits", () => {
		const healthcheck = listeningHealthcheck(80);
		expect(healthcheck.Test[0]).toBe("CMD-SHELL");
		expect(healthcheck.StartInterval).toBe(1_000_000_000);
		expect(healthcheck.StartPeriod).toBe(300_000_000_000);
	});

	test("passes against a real listening socket and fails on a closed port", async () => {
		if (process.platform !== "linux") {
			return;
		}
		const server = Bun.listen({
			hostname: "0.0.0.0",
			port: 0,
			socket: { data: () => undefined },
		});
		const run = async (port: number) =>
			await Bun.spawn(["sh", "-c", listeningScript(port)]).exited;
		const listening = await run(server.port);
		server.stop(true);
		const closed = await run(server.port);
		expect([listening, closed]).toEqual([0, 1]);
	});
});
