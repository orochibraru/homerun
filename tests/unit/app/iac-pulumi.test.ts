import { describe, expect, test } from "bun:test";

import { SECRET_MASK } from "../../../src/lib/formatting";
import type { GeneratedFile, Inventory } from "../../../src/lib/iac/generate";
import {
	detectPulumiDrift,
	generatePulumiProgram,
	pulumiClass,
	pulumiInstances,
	pulumiProperty,
	pulumiType,
	renderTypeScript,
} from "../../../src/lib/iac/pulumi";
import { iacResource } from "../../../src/lib/iac/resources";

const service = iacResource("homerun_service");
if (!service) {
	throw new Error("missing homerun_service");
}
const attribute = (name: string) => {
	const found = service.attributes.find((entry) => entry.name === name);
	if (!found) {
		throw new Error(`missing ${name}`);
	}
	return found;
};

const inventory: Inventory = {
	homerun_service: [
		{
			capAdd: ["NET_ADMIN"],
			containerPort: 80,
			envVars: { API_KEY: "secret", MODE: "prod" },
			id: "svc-1",
			image: "nginx",
			name: "Web",
			publishedPorts: [{ containerPort: 53, hostPort: 5353, protocol: "udp" }],
			replicas: 1,
			secretEnvKeys: ["API_KEY"],
			slug: "web",
			stackId: "stack-2",
			swarmPlacement: {
				constraints: ["env==prod"],
				preferences: [],
				roles: ["worker"],
			},
		},
	],
	homerun_stack: [
		{ id: "stack-2", name: "Data", parentId: "stack-1", slug: "data" },
		{ id: "stack-1", name: "Apps", parentId: null, slug: "apps" },
	],
};

describe("Pulumi names", () => {
	test("follow the bridged provider: camelCase, lists pluralized, classes and tokens per type", () => {
		expect(pulumiProperty(attribute("memoryLimitMb"))).toBe("memoryLimitMb");
		expect(pulumiProperty(attribute("capAdd"))).toBe("capAdds");
		expect(pulumiProperty(attribute("command"))).toBe("commands");
		expect(pulumiProperty(attribute("domains"))).toBe("domains");
		expect(pulumiProperty(attribute("previewBranchInclude"))).toBe(
			"previewBranchIncludes",
		);
		expect(pulumiProperty(attribute("swarmPlacement"))).toBe("swarmPlacement");
		const dns = iacResource("homerun_dns_connection");
		expect(dns && pulumiProperty(dns.attributes[1])).toBe("dnsProvider");
		expect(pulumiClass("homerun_service_environment")).toBe(
			"ServiceEnvironment",
		);
		expect(pulumiType("homerun_service_environment")).toBe(
			"homerun:index/serviceEnvironment:ServiceEnvironment",
		);
	});
});

describe("renderTypeScript", () => {
	test("writes literals, quoting keys that aren't identifiers", () => {
		expect(
			renderTypeScript({ "a-b": 'x"y', list: [1, 2], nested: [{ on: true }] }),
		).toBe(
			'{\n  "a-b": "x\\"y",\n  list: [1, 2],\n  nested: [\n    {\n      on: true,\n    },\n  ],\n}',
		);
		expect(renderTypeScript({})).toBe("{}");
	});
});

describe("generatePulumiProgram", () => {
	const files = generatePulumiProgram(inventory, {
		endpoint: "https://homerun.example.com",
		generatedAt: new Date("2026-11-09T12:00:00Z"),
		login: "pulumi login 's3://iac/apps'",
		name: "Apps",
		project: "apps",
	});
	const file = (path: string) =>
		(files.find((entry) => entry.path === path) as GeneratedFile).content;
	const program = file("index.ts");

	test("lays the project out like a pulumi new typescript project", () => {
		expect(files.map((entry) => entry.path)).toEqual([
			"README.md",
			"Pulumi.yaml",
			"package.json",
			"tsconfig.json",
			"index.ts",
			"secrets.sh",
			".gitignore",
		]);
		expect(file("Pulumi.yaml")).toStartWith("name: apps\n");
		expect(JSON.parse(file("package.json")).name).toBe("apps");
		expect(file("README.md")).toContain("pulumi login 's3://iac/apps'");
		expect(file("README.md")).toContain(
			"pulumi package add terraform-provider zedensix/homerun",
		);
		expect(file(".gitignore")).toContain("secrets.sh");
	});

	test("creates every object with the import option, parents first, references as ids", () => {
		expect(program).toStartWith(
			'import * as homerun from "@pulumi/homerun";\nimport * as pulumi from "@pulumi/pulumi";\n\nconst config = new pulumi.Config();\n',
		);
		expect(program.indexOf('new homerun.Stack(\n  "apps"')).toBeLessThan(
			program.indexOf('new homerun.Stack(\n  "data"'),
		);
		expect(program).toContain("parentId: appsStack.id,");
		expect(program).toContain("stackId: dataStack.id,");
		expect(program).toContain('{ import: "svc-1" },');
		expect(program).toContain('capAdds: ["NET_ADMIN"],');
		expect(program).toContain(
			'publishedPorts: [\n      {\n        containerPort: 53,\n        hostPort: 5353,\n        protocol: "udp",\n      },\n    ],',
		);
		expect(program).toContain(
			'swarmPlacement: {\n      roles: ["worker"],\n      constraints: ["env==prod"],\n      preferences: [],\n    },',
		);
		expect(program).not.toContain("replicas");
	});

	test("reads secrets from stack config, set by secrets.sh with their values, masked in the preview", () => {
		expect(program).toContain('API_KEY: config.requireSecret("web_api_key"),');
		expect(program).toContain('MODE: "prod",');
		expect(program).not.toContain('"secret"');
		const secrets = files.find((entry) => entry.path === "secrets.sh");
		expect(secrets?.content).toContain(
			"pulumi config set --secret web_api_key -- 'secret'",
		);
		expect(secrets?.preview).toContain(`-- '${SECRET_MASK}'`);
	});

	test("leaves out the config and secrets.sh when nothing is secret", () => {
		const plain = generatePulumiProgram(
			{ homerun_stack: [{ id: "s", name: "S", parentId: null, slug: "s" }] },
			{
				endpoint: "http://x",
				generatedAt: new Date(0),
				login: null,
				name: "S",
				project: "s",
			},
		);
		expect(plain.map((entry) => entry.path)).not.toContain("secrets.sh");
		expect(
			plain.find((entry) => entry.path === "index.ts")?.content,
		).not.toContain("pulumi.Config");
	});
});

const checkpoint = (outputs: Record<string, unknown>) =>
	JSON.stringify({
		checkpoint: {
			latest: {
				resources: [
					{
						custom: false,
						type: "pulumi:pulumi:Stack",
						urn: "urn:pulumi:prod::apps::pulumi:pulumi:Stack::apps-prod",
					},
					{
						custom: true,
						id: "default",
						type: "pulumi:providers:homerun",
						urn: "urn:pulumi:prod::apps::pulumi:providers:homerun::default",
					},
					{
						custom: true,
						id: "svc-1",
						outputs,
						type: "homerun:index/service:Service",
						urn: "urn:pulumi:prod::apps::homerun:index/service:Service::web",
					},
					{
						custom: true,
						external: true,
						id: "stack-1",
						type: "homerun:index/stack:Stack",
						urn: "urn:pulumi:prod::apps::homerun:index/stack:Stack::apps",
					},
				],
			},
			stack: "organization/apps/prod",
		},
		version: 3,
	});

describe("pulumiInstances", () => {
	test("reads the managed Homerun resources, keyed by Terraform name, secrets left out", () => {
		const [instance, ...rest] = pulumiInstances(
			checkpoint({
				capAdds: ["NET_ADMIN"],
				envVars: {
					"1b47061264138c4ac30d75fd1eb44270": "",
					"4dabf18193072939515e22adb298388d":
						"1b47061264138c4ac30d75fd1eb44270",
					ciphertext: "v1:abc",
				},
				id: "svc-1",
				publishedPorts: [
					{ containerPort: 53, hostPort: 5353, protocol: "udp" },
				],
				swarmPlacement: { constraints: [], preferences: [], roles: ["worker"] },
			}),
		);
		expect(rest).toEqual([]);
		expect(instance.address).toBe('homerun.Service("web")');
		expect(instance.type).toBe("homerun_service");
		expect(instance.attributes).toEqual({
			cap_add: ["NET_ADMIN"],
			id: "svc-1",
			published_ports: [
				{ container_port: 53, host_port: 5353, protocol: "udp" },
			],
			swarm_placement: { constraints: [], preferences: [], roles: ["worker"] },
		});
	});

	test("refuses a body that isn't a JSON object", () => {
		expect(() => pulumiInstances("[]")).toThrow();
	});
});

describe("detectPulumiDrift", () => {
	test("reports what changed outside Pulumi, attribute by attribute", () => {
		const report = detectPulumiDrift(
			checkpoint({
				capAdds: ["NET_ADMIN"],
				swarmPlacement: { constraints: [], preferences: [], roles: ["worker"] },
			}),
			inventory,
		);
		expect(report.missing).toEqual([]);
		expect(report.drifted).toEqual([
			{
				address: 'homerun.Service("web")',
				changes: [
					{
						attribute: "swarm_placement",
						live: {
							constraints: ["env==prod"],
							preferences: [],
							roles: ["worker"],
						},
						sensitive: false,
						state: { constraints: [], preferences: [], roles: ["worker"] },
					},
				],
				id: "svc-1",
				type: "homerun_service",
			},
		]);
		expect(report.unmanaged.map((object) => object.id).sort()).toEqual([
			"stack-1",
			"stack-2",
		]);
	});
});
