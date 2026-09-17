import { describe, expect, test } from "bun:test";
import { isDeployed, workloadId } from "$lib/service-state";

describe("isDeployed", () => {
	test("a standalone service is deployed once it has a container", () => {
		expect(isDeployed({ containerId: "abc123", swarmServiceId: null })).toBe(
			true,
		);
	});

	test("a swarm service is deployed on its swarm service id alone", () => {
		// The real bug: swarm mode never sets containerId, so gating on it told
		// every healthy swarm service it had never been deployed.
		expect(isDeployed({ containerId: null, swarmServiceId: "p10z6a15" })).toBe(
			true,
		);
	});

	test("neither id means nothing to stream from", () => {
		expect(isDeployed({ containerId: null, swarmServiceId: null })).toBe(false);
		expect(isDeployed({ containerId: "", swarmServiceId: "" })).toBe(false);
	});
});

describe("workloadId", () => {
	test("prefers the container, falls back to the swarm service", () => {
		expect(workloadId({ containerId: "abc", swarmServiceId: "xyz" })).toBe(
			"abc",
		);
		expect(workloadId({ containerId: null, swarmServiceId: "xyz" })).toBe(
			"xyz",
		);
		expect(workloadId({ containerId: null, swarmServiceId: null })).toBeNull();
	});
});
