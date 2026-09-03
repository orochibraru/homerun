import { describe, expect, test } from "bun:test";
import {
	deployInputSchema,
	envVarSchema,
} from "../../../packages/agent/schemas";

function validDeployInput() {
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

describe("deployInputSchema", () => {
	test("accepts a fully-populated valid input", () => {
		const result = deployInputSchema.safeParse(validDeployInput());
		expect(result.success).toBe(true);
	});

	test("defaults envVars to an empty array when omitted", () => {
		const input: Record<string, unknown> = validDeployInput();
		input.envVars = undefined;
		const result = deployInputSchema.safeParse(input);
		expect(result.success).toBe(true);
		expect(result.success && result.data.envVars).toEqual([]);
	});

	test("registryAuth may be omitted entirely", () => {
		const input: Record<string, unknown> = validDeployInput();
		input.registryAuth = undefined;
		expect(deployInputSchema.safeParse(input).success).toBe(true);
	});

	test("registryAuth may be explicitly null", () => {
		const input = { ...validDeployInput(), registryAuth: null };
		expect(deployInputSchema.safeParse(input).success).toBe(true);
	});

	test("accepts a populated registryAuth", () => {
		const input = {
			...validDeployInput(),
			registryAuth: {
				password: "hunter2",
				serveraddress: "https://registry.example.com",
				username: "me",
			},
		};
		expect(deployInputSchema.safeParse(input).success).toBe(true);
	});

	test("containerPort may be null (no exposed port)", () => {
		const input = { ...validDeployInput(), containerPort: null };
		expect(deployInputSchema.safeParse(input).success).toBe(true);
	});

	test.each([0, -1, 65_536, 1.5])(
		"rejects an out-of-range containerPort (%p)",
		(containerPort) => {
			const input = { ...validDeployInput(), containerPort };
			expect(deployInputSchema.safeParse(input).success).toBe(false);
		},
	);

	test("rejects an unknown networkMode", () => {
		const input = { ...validDeployInput(), networkMode: "overlay" };
		expect(deployInputSchema.safeParse(input).success).toBe(false);
	});

	test("rejects an unknown portProtocol", () => {
		const input = { ...validDeployInput(), portProtocol: "sctp" };
		expect(deployInputSchema.safeParse(input).success).toBe(false);
	});

	test("rejects an unknown restartPolicy", () => {
		const input = { ...validDeployInput(), restartPolicy: "sometimes" };
		expect(deployInputSchema.safeParse(input).success).toBe(false);
	});

	test.each(["image", "tag", "serviceId", "slug"] as const)(
		"rejects an empty required string field (%s)",
		(field) => {
			const input = { ...validDeployInput(), [field]: "" };
			expect(deployInputSchema.safeParse(input).success).toBe(false);
		},
	);

	test.each([
		"image",
		"tag",
		"serviceId",
		"slug",
		"networkMode",
		"portProtocol",
		"restartPolicy",
	] as const)("rejects a missing required field (%s)", (field) => {
		const input: Record<string, unknown> = validDeployInput();
		delete input[field];
		expect(deployInputSchema.safeParse(input).success).toBe(false);
	});

	test("cpuLimit rejects zero and negative values but allows null", () => {
		expect(
			deployInputSchema.safeParse({ ...validDeployInput(), cpuLimit: 0 })
				.success,
		).toBe(false);
		expect(
			deployInputSchema.safeParse({ ...validDeployInput(), cpuLimit: -1 })
				.success,
		).toBe(false);
		expect(
			deployInputSchema.safeParse({ ...validDeployInput(), cpuLimit: null })
				.success,
		).toBe(true);
	});

	test("memoryLimitMb must be a positive integer, or null", () => {
		expect(
			deployInputSchema.safeParse({
				...validDeployInput(),
				memoryLimitMb: 512.5,
			}).success,
		).toBe(false);
		expect(
			deployInputSchema.safeParse({
				...validDeployInput(),
				memoryLimitMb: null,
			}).success,
		).toBe(true);
	});
});
