import { describe, expect, test } from "bun:test";
import process from "node:process";
import {
	imageDeclaresHealthcheck,
	listeningHealthcheck,
	listeningScript,
	type ReadinessInput,
	readinessCheck,
	readinessDescription,
	readinessHealthcheck,
	readinessLabels,
	readinessNeedsImage,
} from "../../../src/lib/services/docker/readiness";

const routed: ReadinessInput = { containerPort: 8080 };
const shell = { hasHealthcheck: false, hasShell: true } as const;

describe("readinessCheck", () => {
	test("the service's healthcheck command wins, routed or not", () => {
		expect(
			readinessCheck({ ...routed, healthcheckCommand: "true" }, undefined),
		).toEqual({ kind: "service-healthcheck" });
		expect(
			readinessCheck(
				{ ...routed, dnsResolvable: false, healthcheckCommand: "true" },
				undefined,
			),
		).toEqual({ kind: "service-healthcheck" });
	});

	test("nothing to gate without a Traefik route", () => {
		for (const input of [
			{ ...routed, dnsResolvable: false },
			{ ...routed, networkMode: "host" as const },
			{ ...routed, remote: true },
		]) {
			expect(readinessCheck(input, shell)).toEqual({
				kind: "none",
				reason: "not-routed",
			});
		}
	});

	test("the image's own healthcheck is used as is", () => {
		expect(readinessCheck(routed, { hasHealthcheck: true })).toEqual({
			kind: "image-healthcheck",
		});
	});

	test("with no healthcheck, a routed TCP port gets the generated listening check", () => {
		expect(readinessCheck(routed, shell)).toEqual({
			kind: "listening",
			port: 8080,
		});
		expect(readinessCheck({ ...routed, portProtocol: "both" }, shell)).toEqual({
			kind: "listening",
			port: 8080,
		});
	});

	test("no gate for a UDP-only port, an image without a shell, or one that can't be inspected", () => {
		expect(readinessCheck({ ...routed, portProtocol: "udp" }, shell)).toEqual({
			kind: "none",
			reason: "udp-only",
		});
		expect(
			readinessCheck(routed, { hasHealthcheck: false, hasShell: false }),
		).toEqual({ kind: "none", reason: "no-shell" });
		expect(readinessCheck(routed, null)).toEqual({
			kind: "none",
			reason: "image-unknown",
		});
	});
});

describe("readinessNeedsImage", () => {
	test("only a routed TCP service without a healthcheck command needs the image looked at", () => {
		expect(readinessNeedsImage(routed)).toBe(true);
		expect(readinessNeedsImage({ ...routed, healthcheckCommand: "true" })).toBe(
			false,
		);
		expect(readinessNeedsImage({ ...routed, dnsResolvable: false })).toBe(
			false,
		);
		expect(readinessNeedsImage({ ...routed, portProtocol: "udp" })).toBe(false);
	});
});

describe("imageDeclaresHealthcheck", () => {
	test("NONE and an empty test don't count", () => {
		expect(imageDeclaresHealthcheck(undefined)).toBe(false);
		expect(imageDeclaresHealthcheck([])).toBe(false);
		expect(imageDeclaresHealthcheck(["NONE"])).toBe(false);
		expect(imageDeclaresHealthcheck(["CMD-SHELL", "true"])).toBe(true);
	});
});

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

	test("only the listening check is labelled and only gated checks set a healthcheck", () => {
		expect(readinessLabels({ kind: "listening", port: 80 })).toEqual({
			"homerun.readiness": "listening",
		});
		expect(readinessLabels({ kind: "image-healthcheck" })).toEqual({});
		expect(
			readinessHealthcheck({ kind: "image-healthcheck" }, null),
		).toBeUndefined();
		expect(
			readinessHealthcheck({ kind: "none", reason: "no-shell" }, null),
		).toBeUndefined();
		expect(
			readinessHealthcheck({ kind: "service-healthcheck" }, "true")?.Test,
		).toEqual(["CMD-SHELL", "true"]);
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

describe("readinessDescription", () => {
	test("says what gates traffic, and why nothing does", () => {
		expect(
			readinessDescription({ kind: "listening", port: 3000 }, "task"),
		).toContain("port 3000 to be listening");
		expect(
			readinessDescription({ kind: "none", reason: "no-shell" }, "container"),
		).toContain("no /bin/sh");
	});
});
