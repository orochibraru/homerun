import {
	type SwarmTaskLike,
	swarmSampleFromTasks,
	type WorkloadHealthSample,
} from "$lib/revisions";
import type { BaseDockerService, Constructor } from "./base.ts";
import {
	type ContainerHealthSample,
	containerSampleFromInspect,
} from "./rollout.ts";

function isNotFound(error: unknown): boolean {
	return (error as { statusCode?: number } | null)?.statusCode === 404;
}

/** Mixin adding revision-tracking support : resolving local image ids for retained revisions, and sampling a running workload's health for rollback decisions. */
export function DockerRevisionMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerRevisionService extends Base {
		/** The local image id `ref` resolves to, or null if it isn't (or is no longer) present on this daemon. */
		async localImageId(ref: string): Promise<string | null> {
			try {
				return (await this.getDocker().getImage(ref).inspect()).Id ?? null;
			} catch {
				return null;
			}
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
					await this.getDocker().getContainer(containerId).inspect(),
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
			const docker = this.getDocker();
			const spec = (await docker.getService(swarmServiceId).inspect()).Spec as {
				Mode?: { Replicated?: { Replicas?: number } };
			};
			const tasks = (await docker.listTasks({
				filters: JSON.stringify({ service: [swarmServiceId] }),
			})) as SwarmTaskLike[];
			return swarmSampleFromTasks(
				tasks,
				spec.Mode?.Replicated?.Replicas ?? 1,
				since,
			);
		}
	};
}
