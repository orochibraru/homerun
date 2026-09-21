import type { BaseDockerService, Constructor } from "./base.ts";
import type { ContainerSample } from "./containers.ts";
import type { SwarmTask } from "./swarm.ts";

interface SwarmNodeRow {
	Description?: { Hostname?: string };
	ID?: string;
}

interface RequiresContainerMixin {
	sampleContainerStats: (
		containerId: string,
	) => Promise<ContainerSample | null>;
}

export interface SwarmReplica {
	containerId: string | null;
	desiredState: string;
	error: string | null;
	local: boolean;
	node: string;
	sample: ContainerSample | null;
	slot: number | null;
	state: string;
	taskId: string;
	updatedAt: string | null;
}

/**
 * The sum of every replica's sample, which is what the service's own usage
 * graph records in swarm mode : CPU percentages and memory add up across
 * replicas the same way `docker stats` rows would. Null when no replica has
 * a sample (nothing running on this host).
 */
export function sumReplicaSamples(
	samples: Array<ContainerSample | null>,
): ContainerSample | null {
	const present = samples.filter((sample) => sample !== null);
	if (present.length === 0) {
		return null;
	}
	return present.reduce((total, sample) => ({
		cpuPercent: total.cpuPercent + sample.cpuPercent,
		memLimitMb: total.memLimitMb + sample.memLimitMb,
		memUsedMb: total.memUsedMb + sample.memUsedMb,
		netRxBytes: total.netRxBytes + sample.netRxBytes,
		netTxBytes: total.netTxBytes + sample.netTxBytes,
	}));
}

/** Orders replicas by slot, then by most recently updated, so a restarted slot's live task sits above its dead predecessors. */
export function sortReplicas(replicas: SwarmReplica[]): SwarmReplica[] {
	return [...replicas].sort(
		(a, b) =>
			(a.slot ?? Number.MAX_SAFE_INTEGER) -
				(b.slot ?? Number.MAX_SAFE_INTEGER) ||
			(b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
	);
}

/** Mixin adding per-replica inspection for swarm-mode services : each task's node and state, plus live stats for the ones running on this host. */
export function DockerSwarmReplicasMixin<
	TBase extends Constructor<BaseDockerService & RequiresContainerMixin>,
>(Base: TBase) {
	return class DockerSwarmReplicasService extends Base {
		/**
		 * Every task the swarm currently wants running for this service, with
		 * its node's hostname and a live `docker stats` sample when the task's
		 * container is on this daemon. Tasks on other nodes come back with
		 * `local: false` and no sample : the app only reaches the local
		 * manager's socket. Returns an empty list when the service is gone.
		 */
		async listSwarmReplicas(swarmServiceId: string): Promise<SwarmReplica[]> {
			let tasks: SwarmTask[];
			try {
				tasks = await this.worker.get<SwarmTask[]>(
					`/v1/swarm/services/${swarmServiceId}/tasks`,
					{ running: "1" },
				);
			} catch {
				return [];
			}
			const [info, nodes] = await Promise.all([
				this.worker
					.get<{ Swarm?: { NodeID?: string } }>("/v1/info")
					.catch(() => null),
				this.worker
					.get<SwarmNodeRow[]>("/v1/swarm/nodes")
					.catch(() => [] as SwarmNodeRow[]),
			]);
			const localNodeId: string | undefined = info?.Swarm?.NodeID;
			const hostnames = new Map(
				nodes.map((node) => [
					node.ID ?? "",
					node.Description?.Hostname ?? node.ID ?? "",
				]),
			);

			const replicas = await Promise.all(
				tasks.map(async (task): Promise<SwarmReplica> => {
					const containerId = task.Status?.ContainerStatus?.ContainerID ?? null;
					const local = !!localNodeId && task.NodeID === localNodeId;
					const state = String(task.Status?.State ?? "unknown");
					const sample =
						local && containerId && state === "running"
							? await this.sampleContainerStats(containerId)
							: null;
					return {
						containerId,
						desiredState: String(task.DesiredState ?? "unknown"),
						error: task.Status?.Err ?? null,
						local,
						node: hostnames.get(task.NodeID ?? "") ?? task.NodeID ?? "",
						sample,
						slot: task.Slot ?? null,
						state,
						taskId: task.ID ?? "",
						updatedAt: task.UpdatedAt ?? null,
					};
				}),
			);
			return sortReplicas(replicas);
		}
	};
}
