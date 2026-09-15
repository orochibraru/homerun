import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { externalProbeSkipReason } = await import(
	"../../../src/lib/services/uptime/uptime-probe"
);

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
