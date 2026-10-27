import { describe, expect, mock, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { WorkerRequestError } =
	await import("../../../src/lib/server/worker-client");
const { DockerOtelMixin } =
	await import("../../../src/lib/services/docker/otel");
const { swarmNetworkName } =
	await import("../../../src/lib/services/docker/swarm");

function fakeService(
	networks: Record<string, unknown> | null,
	connectStatus?: number,
) {
	const connects: { network: string; path: string }[] = [];
	const worker = {
		get: async () => ({
			Id: "otel-id",
			NetworkSettings: { Networks: networks },
			State: { Running: true },
		}),
		post: async (path: string, body: { network: string }) => {
			connects.push({ network: body.network, path });
			if (connectStatus) {
				throw new WorkerRequestError("nope", connectStatus);
			}
			return {};
		},
	};
	class FakeBase {
		get worker() {
			return worker;
		}
	}
	const Service = DockerOtelMixin(
		FakeBase as unknown as Parameters<typeof DockerOtelMixin>[0],
	);
	return { connects, service: new Service() };
}

describe("attachOtelToSwarm", () => {
	test("connects the collector to the swarm overlay", async () => {
		const { connects, service } = fakeService({ homerun: {} });
		await service.attachOtelToSwarm();
		expect(connects).toEqual([
			{ network: swarmNetworkName(), path: "/v1/containers/otel-id/connect" },
		]);
	});

	test("skips a collector already on the overlay", async () => {
		const { connects, service } = fakeService({ [swarmNetworkName()]: {} });
		await service.attachOtelToSwarm();
		expect(connects).toEqual([]);
	});

	test("ignores a missing overlay outside swarm mode", async () => {
		const { service } = fakeService({ homerun: {} }, 404);
		await service.attachOtelToSwarm();
	});

	test("rethrows any other failure", async () => {
		const { service } = fakeService({ homerun: {} }, 500);
		expect(service.attachOtelToSwarm()).rejects.toThrow("nope");
	});
});
