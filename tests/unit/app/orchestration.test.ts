import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { deployedServices } = await import(
	"../../../src/lib/services/orchestration.service"
);

describe("deployedServices", () => {
	test("keeps services with a container or a swarm service, drops never-deployed ones", () => {
		const services = [
			{ containerId: "abc", id: "container", swarmServiceId: null },
			{ containerId: null, id: "swarm", swarmServiceId: "xyz" },
			{ containerId: null, id: "never", swarmServiceId: null },
		];
		expect(deployedServices(services).map((service) => service.id)).toEqual([
			"container",
			"swarm",
		]);
	});
});
