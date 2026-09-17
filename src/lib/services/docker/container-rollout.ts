import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { RemoteHostConnection } from "./client.ts";
import { SERVICE_ID_LABEL } from "./labels.ts";
import {
	containerSampleFromInspect,
	type ReadinessVerdict,
	ROLLOUT_POLL_MS,
	RolloutFailedError,
	type RolloutStrategy,
	readinessVerdict,
	rolloutStrategy,
} from "./rollout.ts";

const logger = new Logger("Docker");

export interface ContainerRollout {
	previous: Array<{ Id: string; State: string }>;
	remote: RemoteHostConnection | null | undefined;
	strategy: RolloutStrategy;
}

export interface ContainerRolloutInput {
	networkMode?: "bridge" | "host";
	remote?: RemoteHostConnection | null;
	serviceId: string;
	volumes?: Array<{ readOnly: boolean }>;
}

function isNotFoundError(error: unknown): boolean {
	return (error as { statusCode?: number } | null)?.statusCode === 404;
}

/**
 * How a redeploy replaces a service's container : blue-green (start the new
 * one next to the running one, remove the old one once the new one is ready)
 * or recreate (remove the old one first). Sits ahead of the container mixin
 * in the merge chain, which calls it from `createAndStartContainer`.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
export function DockerContainerRolloutMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerContainerRolloutService extends Base {
		/**
		 * Finds the service's existing containers (by label, not name) and
		 * picks the rollout strategy. A recreate removes them right away and
		 * says why when there is a reason worth reading.
		 */
		async beginContainerRollout(
			input: ContainerRolloutInput,
			onProgress?: (line: string) => void,
		): Promise<ContainerRollout> {
			const previous = await this.getDocker(input.remote).listContainers({
				all: true,
				filters: JSON.stringify({
					label: [`${SERVICE_ID_LABEL}=${input.serviceId}`],
				}),
			});
			const strategy = rolloutStrategy({
				hasRunningPrevious:
					!input.remote && previous.some((info) => info.State === "running"),
				networkMode: input.networkMode,
				volumes: input.volumes,
			});
			const rollout = { previous, remote: input.remote, strategy };
			if (strategy.kind === "recreate") {
				if (strategy.reason) {
					onProgress?.(strategy.reason);
				}
				await this.#removePrevious(rollout, onProgress);
			} else {
				onProgress?.(
					"Keeping the previous container serving until the new one is ready...",
				);
			}
			return rollout;
		}

		/**
		 * Cleans up after the new container failed to start: during a
		 * blue-green rollout it's removed so the previous one stays the only
		 * copy. Always rethrows `error`.
		 */
		async abandonContainerRollout(
			rollout: ContainerRollout,
			containerId: string,
			error: unknown,
		): Promise<never> {
			if (rollout.strategy.kind === "blue-green") {
				await this.getDocker(rollout.remote)
					.getContainer(containerId)
					.remove({ force: true })
					.catch(() => undefined);
			}
			throw error;
		}

		/**
		 * Finishes a blue-green rollout once the new container is running:
		 * waits for it to be ready, then removes the previous containers. A
		 * recreate has nothing left to do.
		 *
		 * @throws `RolloutFailedError` when the new container never became
		 *   ready; it has been removed and the previous one keeps serving.
		 */
		async completeContainerRollout(
			rollout: ContainerRollout,
			containerId: string,
			onProgress?: (line: string) => void,
		): Promise<void> {
			if (rollout.strategy.kind === "recreate") {
				return;
			}
			await this.#awaitReadyOrDiscard(rollout, containerId, onProgress);
			await this.#removePrevious(rollout, onProgress);
		}

		/** Stops and removes the rollout's previous containers, skipping any that are already gone or won't go. */
		async #removePrevious(
			rollout: ContainerRollout,
			onProgress?: (line: string) => void,
		): Promise<void> {
			if (rollout.previous.length === 0) {
				return;
			}
			onProgress?.("Removing the previous container...");
			const docker = this.getDocker(rollout.remote);
			await Promise.all(
				rollout.previous.map(async (info) => {
					const existing = docker.getContainer(info.Id);
					if (info.State === "running") {
						await existing.stop().catch(() => undefined);
					}
					await existing.remove({ force: true }).catch(() => undefined);
				}),
			);
		}

		/**
		 * Polls the new container until `readinessVerdict` settles. On failure
		 * it appends the container's last log lines to the progress and
		 * removes it.
		 *
		 * @throws `RolloutFailedError` when the container never became ready.
		 */
		async #awaitReadyOrDiscard(
			rollout: ContainerRollout,
			containerId: string,
			onProgress?: (line: string) => void,
		): Promise<void> {
			const container = this.getDocker(rollout.remote).getContainer(
				containerId,
			);
			const startedAt = Date.now();
			let verdict: ReadinessVerdict = { verdict: "pending" };
			while (verdict.verdict === "pending") {
				// biome-ignore lint/performance/noAwaitInLoops: readiness is polled one tick at a time
				await new Promise((resolvePromise) =>
					setTimeout(resolvePromise, ROLLOUT_POLL_MS),
				);
				const info = await container.inspect().catch((error) => {
					if (isNotFoundError(error)) {
						return null;
					}
					throw error;
				});
				verdict = readinessVerdict(
					containerSampleFromInspect(info),
					Date.now() - startedAt,
				);
			}
			if (verdict.verdict === "ready") {
				onProgress?.(
					`New container ready after ${Math.round((Date.now() - startedAt) / 1000)}s, switching traffic to it.`,
				);
				return;
			}
			const logs = await container
				.logs({ stderr: true, stdout: true, tail: 20 })
				.then((buffer) => buffer.toString("utf8").trim())
				.catch(() => "");
			for (const line of logs.split("\n").filter(Boolean)) {
				onProgress?.(`  ${line}`);
			}
			await container.remove({ force: true }).catch(() => undefined);
			logger.warn(
				`Rollout failed, kept the previous container: ${verdict.reason}`,
			);
			throw new RolloutFailedError(
				`${verdict.reason} The previous container keeps serving.`,
			);
		}
	};
}
