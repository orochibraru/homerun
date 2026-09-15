import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { projectIdFromNetworkName, projectNetworkName } = await import(
	"../../../src/lib/services/docker/networks"
);

describe("projectIdFromNetworkName", () => {
	test("round-trips the name a project's network is created under", () => {
		const id = "8d1f0a4c-2b3e-4f5a-9c6d-7e8f9a0b1c2d";
		expect(projectIdFromNetworkName(projectNetworkName(id))).toBe(id);
	});

	test("ignores every network that isn't a project's", () => {
		expect(projectIdFromNetworkName("homerun")).toBeNull();
		expect(projectIdFromNetworkName("bridge")).toBeNull();
		expect(projectIdFromNetworkName("host")).toBeNull();
		expect(projectIdFromNetworkName("homerun-project-")).toBeNull();
		expect(projectIdFromNetworkName("")).toBeNull();
	});
});
