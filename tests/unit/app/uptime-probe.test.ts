import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { externalProbeSkipReason, internalProbeMethod, probeErrorMessage } =
	await import("../../../src/lib/services/uptime/uptime-probe");

describe("externalProbeSkipReason", () => {
	test("skips loopback hostnames, with or without a port", () => {
		expect(externalProbeSkipReason("localhost")).toContain("loopback");
		expect(externalProbeSkipReason("127.0.0.1")).toContain("loopback");
		expect(externalProbeSkipReason("localhost:5173")).toContain("loopback");
		expect(externalProbeSkipReason("api.localhost")).toContain("loopback");
	});

	test("probes anything that could actually answer from outside", () => {
		expect(externalProbeSkipReason("app.example.com")).toBeNull();
		expect(externalProbeSkipReason("203.0.113.10")).toBeNull();
		// Not a loopback host, just one containing the word.
		expect(externalProbeSkipReason("localhost.example.com")).toBeNull();
	});
});

describe("internalProbeMethod", () => {
	test("an image's own healthcheck always wins", () => {
		expect(internalProbeMethod("postgres:18-alpine", true)).toBe("healthcheck");
		expect(internalProbeMethod("nginx:alpine", true)).toBe("healthcheck");
	});

	test("a datastore without one is probed over plain TCP", () => {
		expect(internalProbeMethod("postgres:18-alpine", false)).toBe("tcp");
		expect(internalProbeMethod("redis:7", false)).toBe("tcp");
		expect(internalProbeMethod("mysql:8", false)).toBe("tcp");
		expect(internalProbeMethod("mongo:7", false)).toBe("tcp");
	});

	test("anything else is probed over HTTP", () => {
		expect(internalProbeMethod("nginx:alpine", false)).toBe("http");
		expect(internalProbeMethod("ghcr.io/me/my-app:latest", false)).toBe("http");
	});
});

describe("probeErrorMessage", () => {
	test("strips Bun's verbose-fetch tail", () => {
		const err = new Error(
			"Unable to connect. Is the computer able to access the url?\nFor more information, pass `verbose: true` in the second argument to fetch()",
		);
		expect(probeErrorMessage(err)).toBe(
			"Unable to connect. Is the computer able to access the url?",
		);
	});

	test("collapses the cases people actually hit into one sentence", () => {
		expect(probeErrorMessage(new Error("The operation timed out"))).toBe(
			"Timed out.",
		);
		expect(probeErrorMessage(new Error("The operation was aborted"))).toBe(
			"Timed out.",
		);
		expect(probeErrorMessage(new Error("ConnectionRefused"))).toBe(
			"Connection refused.",
		);
		expect(probeErrorMessage(new Error("self-signed certificate"))).toBe(
			"TLS failed: self-signed certificate",
		);
	});

	test("passes anything else through, including a non-Error throw", () => {
		expect(probeErrorMessage(new Error("Nope"))).toBe("Nope");
		expect(probeErrorMessage("plain string")).toBe("plain string");
	});
});
