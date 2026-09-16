import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { stackIdFromNetworkName, stackNetworkName } = await import(
	"../../../src/lib/services/docker/networks"
);

describe("stackIdFromNetworkName", () => {
	test("round-trips the name a stack's network is created under", () => {
		const id = "8d1f0a4c-2b3e-4f5a-9c6d-7e8f9a0b1c2d";
		expect(stackIdFromNetworkName(stackNetworkName(id))).toBe(id);
	});

	test("ignores every network that isn't a stack's", () => {
		expect(stackIdFromNetworkName("homerun")).toBeNull();
		expect(stackIdFromNetworkName("bridge")).toBeNull();
		expect(stackIdFromNetworkName("host")).toBeNull();
		expect(stackIdFromNetworkName("homerun-stack-")).toBeNull();
		expect(stackIdFromNetworkName("")).toBeNull();
	});
});
