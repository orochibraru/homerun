import {
	type SwarmTaskLike,
	swarmSampleFromTasks,
	type WorkloadHealthSample,
} from "$lib/revisions";
import { isNotFound } from "$lib/server/worker-client";
import type { BaseDockerService, Constructor } from "./base.ts";
import {
	type ContainerHealthSample,
	containerSampleFromInspect,
} from "./rollout.ts";

/** Mixin adding revision-tracking support : resolving local image ids for retained revisions, and sampling a running workload's health for rollback decisions. */
export function DockerRevisionMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerRevisionService extends Base {
		/** The local image id `ref` resolves to, or null if it isn't (or is no longer) present on this daemon. */
		async localImageId(ref: string): Promise<string | null> {
			const { id } = await this.worker.get<{ id: string | null }>(
				"v1/images/id",
				{ ref },
			);
			return id;
		}

		/** The distinct local image ids among `refs` that still exist on this daemon, deduplicated. */
		async existingImageIds(refs: string[]): Promise<string[]> {
			const ids = await Promise.all(refs.map((ref) => this.localImageId(ref)));
			return [...new Set(ids.filter((id): id is string => Boolean(id)))];
		}

		/**
		 * Samples a standalone container's current health for
		 * `RevisionHealthService` : state, Docker healthcheck status (if any),
		 * exit code and restart count. Returns a `state: "missing"` sample
		 * rather than throwing when the container is gone.
		 */
		async containerHealthSample(
			containerId: string,
		): Promise<ContainerHealthSample> {
			try {
				return containerSampleFromInspect(
					await this.worker.get<
						Parameters<typeof containerSampleFromInspect>[0]
					>(`v1/containers/${containerId}/inspect`),
				);
			} catch (error) {
				if (!isNotFound(error)) {
					throw error;
				}
				return containerSampleFromInspect(null);
			}
		}

		/**
		 * Samples a swarm service's current health for `RevisionHealthService`
		 * : desired replica count, how many tasks are running, how many
		 * created since `since` failed or were rejected, and the most recent
		 * failure's error (see `swarmSampleFromTasks`).
		 */
		async swarmHealthSample(
			swarmServiceId: string,
			since: Date,
		): Promise<WorkloadHealthSample> {
			const [{ replicas }, tasks] = await Promise.all([
				this.worker.get<{ replicas: number }>(
					`v1/swarm/services/${swarmServiceId}/replicas`,
				),
				this.worker.get<SwarmTaskLike[]>(
					`v1/swarm/services/${swarmServiceId}/tasks`,
				),
			]);
			return swarmSampleFromTasks(tasks, replicas, since);
		}
	};
}
