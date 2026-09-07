import { describe, expect, test } from "bun:test";
import { envVarSchema } from "../../../packages/agent/schemas";

function _validDeployInput() {
	return {
		containerPort: 8080,
		cpuLimit: 1.5,
		envVars: [{ key: "FOO", value: "bar" }],
		image: "nginx",
		memoryLimitMb: 512,
		networkMode: "bridge" as const,
		portProtocol: "tcp" as const,
		registryAuth: null,
		restartPolicy: "always" as const,
		serviceId: "svc-1",
		slug: "my-service",
		tag: "latest",
	};
}

describe("envVarSchema", () => {
	test("accepts a key/value pair", () => {
		expect(envVarSchema.safeParse({ key: "FOO", value: "bar" }).success).toBe(
			true,
		);
	});

	test("accepts an empty value", () => {
		expect(envVarSchema.safeParse({ key: "FOO", value: "" }).success).toBe(
			true,
		);
	});

	test("rejects an empty key", () => {
		expect(envVarSchema.safeParse({ key: "", value: "bar" }).success).toBe(
			false,
		);
	});

	test("rejects a missing value", () => {
		expect(envVarSchema.safeParse({ key: "FOO" }).success).toBe(false);
	});
});
