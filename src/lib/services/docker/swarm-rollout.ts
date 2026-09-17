import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import {
	ROLLOUT_POLL_MS,
	RolloutFailedError,
	SWARM_UPDATE_MAX_WAIT_MS,
	SWARM_UPDATE_MONITOR_NS,
	type SwarmUpdateOutcome,
	type SwarmUpdateStatus,
	swarmUpdateOrder,
	swarmUpdateOutcome,
} from "./rollout.ts";

const logger = new Logger("Swarm");

export interface SwarmServiceSpec {
	Labels: Record<string, string>;
	Mode: { Replicated: { Replicas: number } };
	Name: string;
	TaskTemplate: { ContainerSpec: { Mounts?: Array<{ ReadOnly: boolean }> } };
}

interface InspectedSwarmService {
	Spec: { Name: string; TaskTemplate?: { ForceUpdate?: number } };
	UpdateStatus?: SwarmUpdateStatus;
	Version: { Index: number };
}

/**
 * Rolls an existing swarm service onto a new spec in place, health-gated:
 * swarm starts each new task before stopping an old one (unless a writable
 * volume forces stop-first), waits for its healthcheck, and rolls the service
 * back to the previous spec on its own when a new task fails. Sits ahead of
 * the swarm mixin in the merge chain, which calls it on a redeploy.
 */
export function DockerSwarmRolloutMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerSwarmRolloutService extends Base {
		/**
		 * Updates `swarmServiceId` to `spec` (keeping its name, forcing new
		 * tasks even when nothing else changed) and waits for swarm to finish.
		 *
		 * @throws `RolloutFailedError` when swarm paused or rolled back the
		 *   update, or it didn't finish in time; the previous tasks keep
		 *   serving.
		 */
		async rollOutSwarmService(
			swarmServiceId: string,
			spec: SwarmServiceSpec,
			onProgress?: (line: string) => void,
		): Promise<{ swarmServiceId: string }> {
			const service = this.getDocker().getService(swarmServiceId);
			const inspected = (await service.inspect()) as InspectedSwarmService;
			const order = swarmUpdateOrder(
				spec.TaskTemplate.ContainerSpec.Mounts?.map((mount) => ({
					readOnly: mount.ReadOnly,
				})),
			);
			onProgress?.(
				order === "start-first"
					? "Updating the swarm service : each new task starts first, and swarm stops the old one once the new one is running (healthy, when it has a healthcheck)..."
					: "Updating the swarm service : a writable volume means each old task stops before its replacement starts...",
			);
			await service.update({
				...spec,
				Name: inspected.Spec.Name,
				RollbackConfig: { Order: order, Parallelism: 1 },
				TaskTemplate: {
					...spec.TaskTemplate,
					ForceUpdate: (inspected.Spec.TaskTemplate?.ForceUpdate ?? 0) + 1,
				},
				UpdateConfig: {
					FailureAction: "rollback",
					MaxFailureRatio: 0,
					Monitor: SWARM_UPDATE_MONITOR_NS,
					Order: order,
					Parallelism: 1,
				},
				version: inspected.Version.Index,
			});
			await this.#awaitUpdate(
				swarmServiceId,
				inspected.UpdateStatus?.StartedAt ?? null,
			);
			onProgress?.(
				"Swarm finished rolling out the new tasks; Traefik picks them up on its next swarm poll, within 2 seconds.",
			);
			logger.info(`Swarm service updated in place: id=${swarmServiceId}`);
			return { swarmServiceId };
		}

		/**
		 * Polls the service's `UpdateStatus` until the update this deploy
		 * started completes or fails.
		 *
		 * @throws `RolloutFailedError` on a failed or timed-out update.
		 */
		async #awaitUpdate(
			swarmServiceId: string,
			previousStartedAt: string | null,
		): Promise<void> {
			const service = this.getDocker().getService(swarmServiceId);
			const startedAt = Date.now();
			let outcome: SwarmUpdateOutcome = { state: "pending" };
			while (outcome.state === "pending") {
				if (Date.now() - startedAt > SWARM_UPDATE_MAX_WAIT_MS) {
					throw new RolloutFailedError(
						`Swarm didn't finish updating the service within ${Math.round(SWARM_UPDATE_MAX_WAIT_MS / 60_000)} minutes.`,
					);
				}
				// biome-ignore lint/performance/noAwaitInLoops: the update is polled one tick at a time
				await new Promise((resolvePromise) =>
					setTimeout(resolvePromise, ROLLOUT_POLL_MS),
				);
				const inspected = (await service.inspect()) as InspectedSwarmService;
				outcome = swarmUpdateOutcome(inspected.UpdateStatus, previousStartedAt);
			}
			if (outcome.state === "failed") {
				logger.warn(
					`Swarm update failed: id=${swarmServiceId} ${outcome.reason}`,
				);
				throw new RolloutFailedError(outcome.reason);
			}
		}
	};
}
