import { describe, expect, test } from "bun:test";
import type { ContainerSample } from "../../../src/lib/services/docker/containers";
import {
	DockerSwarmReplicasMixin,
	sumReplicaSamples,
} from "../../../src/lib/services/docker/swarm-replicas";

function sample(cpuPercent: number, memUsedMb: number): ContainerSample {
	return {
		cpuPercent,
		memLimitMb: 1024,
		memUsedMb,
		netRxBytes: 100,
		netTxBytes: 50,
	};
}

describe("sumReplicaSamples", () => {
	test("adds every present sample together", () => {
		expect(sumReplicaSamples([sample(10, 100), null, sample(5, 50)])).toEqual({
			cpuPercent: 15,
			memLimitMb: 2048,
			memUsedMb: 150,
			netRxBytes: 200,
			netTxBytes: 100,
		});
	});

	test("is null when no replica runs on this host", () => {
		expect(sumReplicaSamples([null, null])).toBeNull();
		expect(sumReplicaSamples([])).toBeNull();
	});
});

describe("listSwarmReplicas", () => {
	function fakeService(sampled: string[]) {
		const worker = {
			get: async (path: string) => {
				if (path === "/v1/info") {
					return { Swarm: { NodeID: "local-node" } };
				}
				if (path === "/v1/swarm/nodes") {
					return [
						{ Description: { Hostname: "manager" }, ID: "local-node" },
						{ Description: { Hostname: "worker-1" }, ID: "remote-node" },
					];
				}
				return [
					{
						DesiredState: "running",
						ID: "task-remote",
						NodeID: "remote-node",
						Slot: 2,
						Status: {
							ContainerStatus: { ContainerID: "c2" },
							State: "running",
						},
						UpdatedAt: "2026-09-17T10:00:00Z",
					},
					{
						DesiredState: "running",
						ID: "task-local",
						NodeID: "local-node",
						Slot: 1,
						Status: {
							ContainerStatus: { ContainerID: "c1" },
							State: "running",
						},
						UpdatedAt: "2026-09-17T10:00:00Z",
					},
				];
			},
		};
		class FakeBase {
			get worker() {
				return worker;
			}
			async sampleContainerStats(containerId: string) {
				sampled.push(containerId);
				return sample(20, 64);
			}
		}
		const Service = DockerSwarmReplicasMixin(
			FakeBase as unknown as Parameters<typeof DockerSwarmReplicasMixin>[0],
		);
		return new Service();
	}

	test("samples only local replicas, ordered by slot, with node hostnames", async () => {
		const sampled: string[] = [];
		const replicas = await fakeService(sampled).listSwarmReplicas("svc");
		expect(sampled).toEqual(["c1"]);
		expect(replicas.map((replica) => replica.taskId)).toEqual([
			"task-local",
			"task-remote",
		]);
		expect(replicas[0]?.node).toBe("manager");
		expect(replicas[0]?.local).toBe(true);
		expect(replicas[0]?.sample?.cpuPercent).toBe(20);
		expect(replicas[1]?.node).toBe("worker-1");
		expect(replicas[1]?.local).toBe(false);
		expect(replicas[1]?.sample).toBeNull();
	});
});
