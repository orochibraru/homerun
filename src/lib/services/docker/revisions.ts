import type { WorkloadHealthSample } from "$lib/revisions";
import type { BaseDockerService, Constructor } from "./base.ts";

const CONTAINER_STATES = new Set([
	"running",
	"restarting",
	"exited",
	"created",
]);
const HEALTH_STATES = new Set(["starting", "healthy", "unhealthy"]);

type ContainerSample = Extract<WorkloadHealthSample, { kind: "container" }>;

function isNotFound(error: unknown): boolean {
	return (error as { statusCode?: number } | null)?.statusCode === 404;
}

export function DockerRevisionMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerRevisionService extends Base {
		async localImageId(ref: string): Promise<string | null> {
			try {
				return (await this.getDocker().getImage(ref).inspect()).Id ?? null;
			} catch {
				return null;
			}
		}

		async existingImageIds(refs: string[]): Promise<string[]> {
			const ids = await Promise.all(refs.map((ref) => this.localImageId(ref)));
			return [...new Set(ids.filter((id): id is string => Boolean(id)))];
		}

		async containerHealthSample(containerId: string): Promise<ContainerSample> {
			try {
				const info = await this.getDocker().getContainer(containerId).inspect();
				const status = info.State?.Status ?? "exited";
				const health = info.State?.Health?.Status ?? "none";
				return {
					exitCode: info.State?.ExitCode ?? null,
					health: HEALTH_STATES.has(health)
						? (health as ContainerSample["health"])
						: "none",
					healthOutput: info.State?.Health?.Log?.at(-1)?.Output?.trim() || null,
					kind: "container",
					restartCount: info.RestartCount ?? 0,
					state: CONTAINER_STATES.has(status)
						? (status as ContainerSample["state"])
						: "exited",
				};
			} catch (error) {
				if (!isNotFound(error)) {
					throw error;
				}
				return {
					exitCode: null,
					health: "none",
					healthOutput: null,
					kind: "container",
					restartCount: 0,
					state: "missing",
				};
			}
		}

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
			})) as Array<{
				CreatedAt?: string;
				Status?: { Err?: string; State?: string };
			}>;
			const recent = tasks.filter(
				(task) => new Date(task.CreatedAt ?? 0).getTime() >= since.getTime(),
			);
			const failed = recent.filter((task) =>
				["failed", "rejected"].includes(task.Status?.State ?? ""),
			);
			return {
				desired: spec.Mode?.Replicated?.Replicas ?? 1,
				failed: failed.length,
				kind: "swarm",
				lastError: failed.at(-1)?.Status?.Err ?? null,
				running: recent.filter((task) => task.Status?.State === "running")
					.length,
			};
		}
	};
}
