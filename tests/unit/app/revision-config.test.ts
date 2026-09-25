import { describe, expect, test } from "bun:test";
import {
	changedRevisionConfigFields,
	type RevisionConfigSource,
	restorableRuntimeOptions,
	snapshotRevisionConfig,
} from "$lib/revision-config";

function source(
	overrides: Partial<RevisionConfigSource> = {},
): RevisionConfigSource {
	return {
		capAdd: [],
		command: null,
		containerPort: 8080,
		cpuLimit: null,
		devices: [],
		dnsResolvable: true,
		entrypoint: null,
		envFiles: [],
		envVars: { A: "1", B: "2" },
		labels: {},
		memoryLimitMb: 512,
		networkMode: "bridge",
		portProtocol: "tcp",
		privileged: false,
		publishedPorts: [],
		replicas: 1,
		...overrides,
	};
}

describe("snapshotRevisionConfig", () => {
	test("records published ports as a copy, and a rollback compares them", () => {
		const service = source({
			publishedPorts: [
				{ containerPort: 1194, hostPort: 1194, protocol: "udp" },
			],
		});
		const snapshot = snapshotRevisionConfig(service);
		service.publishedPorts[0].hostPort = 1195;
		expect(snapshot.publishedPorts).toEqual([
			{ containerPort: 1194, hostPort: 1194, protocol: "udp" },
		]);
		expect(changedRevisionConfigFields(service, snapshot)).toEqual([
			"publishedPorts",
		]);
	});

	test("copies env vars instead of sharing the service's object", () => {
		const service = source();
		const snapshot = snapshotRevisionConfig(service);
		service.envVars = { A: "changed" };
		expect(snapshot.envVars).toEqual({ A: "1", B: "2" });
	});

	test("treats missing env vars as empty and host networking as not routed", () => {
		const snapshot = snapshotRevisionConfig(
			source({ dnsResolvable: true, envVars: null, networkMode: "host" }),
		);
		expect(snapshot.envVars).toEqual({});
		expect(snapshot.dnsResolvable).toBe(false);
	});
});

describe("changedRevisionConfigFields", () => {
	test("ignores env var key order", () => {
		const snapshot = snapshotRevisionConfig(source());
		expect(
			changedRevisionConfigFields(
				source({ envVars: { A: "1", B: "2" } }),
				snapshot,
			),
		).toEqual([]);
		expect(
			changedRevisionConfigFields(
				source({ envVars: { B: "2", A: "1" } }),
				snapshot,
			),
		).toEqual([]);
	});

	test("lists every field that differs, sorted", () => {
		const snapshot = snapshotRevisionConfig(source());
		expect(
			changedRevisionConfigFields(
				source({ envVars: { A: "9" }, memoryLimitMb: null, replicas: 3 }),
				snapshot,
			),
		).toEqual(["envVars", "memoryLimitMb", "replicas"]);
	});
});

describe("runtime options in a snapshot", () => {
	test("records runtime options as copies and flags them as changed", () => {
		const service = source({
			capAdd: ["NET_ADMIN"],
			command: ["serve", "--port", "80"],
			labels: { team: "a" },
			privileged: true,
		});
		const snapshot = snapshotRevisionConfig(service);
		service.command?.push("--verbose");
		expect(snapshot.command).toEqual(["serve", "--port", "80"]);
		expect(
			changedRevisionConfigFields(
				source({ entrypoint: ["/init"], privileged: false }),
				snapshot,
			),
		).toEqual(["capAdd", "command", "entrypoint", "labels", "privileged"]);
		expect(restorableRuntimeOptions(snapshot)).toEqual({
			capAdd: ["NET_ADMIN"],
			command: ["serve", "--port", "80"],
			devices: [],
			entrypoint: null,
			envFiles: [],
			labels: { team: "a" },
			privileged: true,
		});
	});

	test("an older snapshot without runtime options restores none and compares none", () => {
		const {
			capAdd,
			command,
			devices,
			entrypoint,
			envFiles,
			labels,
			privileged,
			...older
		} = snapshotRevisionConfig(source());
		expect(restorableRuntimeOptions(older)).toEqual({});
		expect(
			changedRevisionConfigFields(source({ privileged: true }), older),
		).toEqual([]);
	});
});
