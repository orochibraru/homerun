import { describe, expect, test } from "bun:test";
import {
	comparableAttributes,
	IAC_DATA_SOURCES,
	IAC_RESOURCES,
	iacResource,
	iacSpec,
	importIdOf,
	toSnakeCase,
	toStateValue,
} from "../../../src/lib/iac/resources";

describe("the IaC spec", () => {
	test("names every attribute in snake_case, unique per resource", () => {
		expect(toSnakeCase("healthcheckStartPeriodSeconds")).toBe(
			"healthcheck_start_period_seconds",
		);
		for (const resource of IAC_RESOURCES) {
			const names = resource.attributes.map((attribute) => attribute.tf);
			expect(new Set(names).size).toBe(names.length);
			expect(names).not.toContain("provider");
			expect(names).not.toContain("id");
			for (const field of resource.importId.filter((name) => name !== "id")) {
				expect(
					resource.attributes.map((attribute) => attribute.name),
				).toContain(field);
			}
		}
		expect(iacResource("homerun_dns_connection")?.attributes[1]?.tf).toBe(
			"dns_provider",
		);
	});

	test("points every reference at a resource it has", () => {
		const types = new Set(IAC_RESOURCES.map((resource) => resource.type));
		for (const resource of IAC_RESOURCES) {
			for (const attribute of resource.attributes) {
				if (attribute.ref) {
					expect(types.has(attribute.ref)).toBe(true);
				}
			}
		}
		for (const dataSource of IAC_DATA_SOURCES) {
			expect(!dataSource.resource || types.has(dataSource.resource)).toBe(true);
		}
		expect(iacSpec().resources).toBe(IAC_RESOURCES);
	});

	test("leaves secrets and create-only attributes out of comparisons", () => {
		const service = iacResource("homerun_service");
		if (!service) {
			throw new Error("missing homerun_service");
		}
		const names = comparableAttributes(service).map(
			(attribute) => attribute.name,
		);
		expect(names).not.toContain("registryPassword");
		expect(names).not.toContain("templateId");
		expect(names).toContain("replicas");
	});

	test("converts nested objects to state keys and builds composite import ids", () => {
		const service = iacResource("homerun_service");
		const ports = service?.attributes.find(
			(attribute) => attribute.name === "publishedPorts",
		);
		if (!ports) {
			throw new Error("missing publishedPorts");
		}
		expect(
			toStateValue(ports, [
				{ containerPort: 53, hostPort: 5353, protocol: "udp" },
			]),
		).toEqual([{ container_port: 53, host_port: 5353, protocol: "udp" }]);
		expect(toStateValue(ports, undefined)).toBeNull();
		const bucket = iacResource("homerun_bucket");
		if (!bucket) {
			throw new Error("missing homerun_bucket");
		}
		expect(importIdOf(bucket, { name: "tfstate", storeId: "s1" })).toBe(
			"s1/tfstate",
		);
		expect(iacResource("homerun_nothing")).toBeUndefined();
	});
});
