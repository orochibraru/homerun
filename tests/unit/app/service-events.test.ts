import { describe, expect, test } from "bun:test";

import {
	formatEventValue,
	serviceChanges,
} from "../../../src/lib/service-events";

describe("formatEventValue", () => {
	test("reads booleans, lists, empties and objects as one short line", () => {
		expect(formatEventValue(true)).toBe("on");
		expect(formatEventValue(false)).toBe("off");
		expect(formatEventValue(null)).toBe("none");
		expect(formatEventValue("")).toBe("none");
		expect(formatEventValue([])).toBe("none");
		expect(formatEventValue(["a", "b"])).toBe("a, b");
		expect(formatEventValue({ a: 1 })).toBe('{"a":1}');
		expect(formatEventValue(8080)).toBe("8080");
		expect(formatEventValue("x".repeat(100))).toHaveLength(60);
	});
});

describe("serviceChanges", () => {
	test("ignores status, ids and fields that didn't change", () => {
		expect(
			serviceChanges(
				{ containerId: "a", containerPort: 80, currentStatus: "running" },
				{ containerId: "b", containerPort: 80, currentStatus: "stopped" },
			),
		).toEqual([]);
	});

	test("groups changed settings by lane with old and new values", () => {
		const events = serviceChanges(
			{ containerPort: 80, cpuLimit: null, portProtocol: "tcp", tag: "1.0" },
			{ containerPort: 8080, cpuLimit: "0.5", portProtocol: "udp", tag: "1.0" },
		);
		expect(events).toEqual([
			{
				detail: ["Container port: 80 → 8080", "Protocol: tcp → udp"],
				kind: "settings",
				lane: "networking",
				summary: "Changed container port, protocol",
			},
			{
				detail: ["CPU limit: none → 0.5"],
				kind: "settings",
				lane: "config",
				summary: "Changed CPU limit",
			},
		]);
	});

	test("names env vars without their values", () => {
		const [event] = serviceChanges(
			{
				envVars: { KEEP: "1", OLD: "x", TOKEN: "secret-a" },
				secretEnvKeys: ["TOKEN"],
			},
			{
				envVars: { KEEP: "1", NEW: "y", TOKEN: "secret-b" },
				secretEnvKeys: ["TOKEN", "NEW"],
			},
		);
		expect(event.lane).toBe("config");
		expect(event.kind).toBe("env");
		expect(event.detail).toEqual([
			"Added NEW",
			"Changed TOKEN",
			"Removed OLD",
			"Marked NEW secret",
		]);
		expect(event.summary).toBe("Changed 4 environment variables");
		expect(JSON.stringify(event)).not.toContain("secret-");
	});

	test("reads a single env change as its own summary and skips a removed key's unmark", () => {
		const [event] = serviceChanges(
			{ envVars: { DB_URL: "postgres://a" }, secretEnvKeys: ["DB_URL"] },
			{ envVars: {}, secretEnvKeys: [] },
		);
		expect(event.summary).toBe("Removed DB_URL");
		expect(event.detail).toEqual(["Removed DB_URL"]);
	});

	test("records a secret mark alone and drops an env write that changes nothing", () => {
		expect(
			serviceChanges(
				{ envVars: { A: "1" }, secretEnvKeys: ["A"] },
				{ envVars: { A: "1" }, secretEnvKeys: [] },
			)[0].detail,
		).toEqual(["Unmarked A as secret"]);
		expect(
			serviceChanges({ envVars: { A: "1" } }, { envVars: { A: "1" } }),
		).toEqual([]);
	});

	test("never prints secrets or opaque settings", () => {
		const [event] = serviceChanges(
			{
				customSslCertEnc: null,
				customSslKeyEnc: "old-key",
				labels: { a: "1" },
				registryPasswordEnc: "enc",
			},
			{
				customSslCertEnc: "cert",
				customSslKeyEnc: null,
				labels: { a: "2" },
				registryPasswordEnc: "enc2",
			},
		);
		expect(event.detail).toEqual([
			"Custom certificate set",
			"Custom certificate key removed",
		]);
		const [config] = serviceChanges(
			{ labels: { a: "1" }, registryPasswordEnc: "enc" },
			{ labels: { a: "2" }, registryPasswordEnc: "enc2" },
		);
		expect(config.detail).toEqual([
			"Labels changed",
			"Registry password replaced",
		]);
		expect(JSON.stringify([event, config])).not.toContain("enc2");
	});

	test("reads a replica change as a scale on the Lifecycle lane", () => {
		expect(serviceChanges({ replicas: 1 }, { replicas: 3 })).toEqual([
			{
				detail: ["Replicas: 1 → 3"],
				kind: "scale",
				lane: "lifecycle",
				summary: "Scaled to 3 replicas",
			},
		]);
		expect(serviceChanges({ replicas: 2 }, { replicas: 1 })[0].summary).toBe(
			"Scaled to 1 replica",
		);
	});

	test("names the first three settings and counts the rest", () => {
		const [event] = serviceChanges(
			{ autoRollback: false, image: "a", name: "x", tag: "1" },
			{ autoRollback: true, image: "b", name: "y", tag: "2" },
		);
		expect(event.summary).toBe("Changed auto rollback, image, name and 1 more");
	});
});
