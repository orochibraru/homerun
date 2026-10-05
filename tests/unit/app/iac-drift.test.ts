import { describe, expect, test } from "bun:test";
import {
	detectDrift,
	formatDriftValue,
	homerunInstances,
} from "../../../src/lib/iac/drift";

const state = JSON.stringify({
	lineage: "l",
	resources: [
		{
			instances: [
				{
					attributes: {
						container_port: 80,
						env_vars: { A: "1" },
						id: "svc-1",
						name: "Web",
						published_ports: [
							{ container_port: 53, host_port: 5353, protocol: "udp" },
						],
						registry_password: "secret",
						replicas: 1,
						slug: "web",
					},
				},
			],
			mode: "managed",
			name: "web",
			type: "homerun_service",
		},
		{
			instances: [{ attributes: { id: "gone", name: "Old", slug: "old" } }],
			mode: "managed",
			name: "old",
			type: "homerun_stack",
		},
		{
			instances: [
				{
					attributes: {
						expiration_days: 30,
						id: "s1/state",
						name: "state",
						store_id: "s1",
					},
					index_key: 0,
				},
			],
			mode: "managed",
			module: "module.storage",
			name: "state",
			type: "homerun_bucket",
		},
		{
			instances: [{ attributes: { id: "x" } }],
			mode: "data",
			name: "t",
			type: "homerun_template",
		},
		{
			instances: [{ attributes: { id: "y" } }],
			mode: "managed",
			name: "r",
			type: "random_id",
		},
		{
			instances: [{ attributes: { id: "z" } }],
			mode: "managed",
			name: "u",
			type: "homerun_unknown",
		},
	],
	serial: 3,
});

describe("homerunInstances", () => {
	test("lists the managed homerun_ instances with their addresses", () => {
		expect(homerunInstances(state).map((instance) => instance.address)).toEqual(
			[
				"homerun_service.web",
				"homerun_stack.old",
				"module.storage.homerun_bucket.state[0]",
				"homerun_unknown.u",
			],
		);
		expect(() => homerunInstances("[]")).toThrow("isn't a JSON object");
		expect(homerunInstances("{}")).toEqual([]);
	});
});

describe("detectDrift", () => {
	test("reports drifted, missing and unmanaged objects", () => {
		const report = detectDrift(state, {
			homerun_bucket: [
				{ expirationDays: 30, id: "s1/state", name: "state", storeId: "s1" },
			],
			homerun_service: [
				{
					containerPort: 80,
					envVars: { A: "2" },
					id: "svc-1",
					name: "Web",
					publishedPorts: [
						{ containerPort: 53, hostPort: 5353, protocol: "udp" },
					],
					replicas: 3,
					slug: "web",
				},
			],
			homerun_stack: [{ id: "stack-1", name: "New", slug: "new" }],
		});
		expect(report.inSync).toBe(1);
		expect(report.missing).toEqual([
			{ address: "homerun_stack.old", id: "gone", type: "homerun_stack" },
		]);
		expect(report.unmanaged).toEqual([
			{ id: "stack-1", label: "new", type: "homerun_stack" },
		]);
		expect(report.drifted).toHaveLength(1);
		expect(report.drifted[0]?.changes).toEqual([
			{ attribute: "env_vars", live: null, sensitive: true, state: null },
			{ attribute: "replicas", live: 3, sensitive: false, state: 1 },
		]);
	});
});

describe("formatDriftValue", () => {
	test("shows strings as is and the rest as JSON", () => {
		expect(formatDriftValue(null)).toBe("null");
		expect(formatDriftValue(undefined)).toBe("null");
		expect(formatDriftValue("web")).toBe("web");
		expect(formatDriftValue(["a"])).toBe('["a"]');
	});
});
