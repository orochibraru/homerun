import type { WorkloadHealthSample } from "$lib/revisions";

export type ContainerHealthSample = Extract<
	WorkloadHealthSample,
	{ kind: "container" }
>;

export interface RolloutWindow {
	maxWaitMs: number;
	settleMs: number;
}

export const ROLLOUT_WINDOW: RolloutWindow = {
	maxWaitMs: 5 * 60 * 1000,
	settleMs: 5000,
};

/** Thrown when a new workload never became ready, after it was removed and the previous one left serving. */
export class RolloutFailedError extends Error {
	override name = "RolloutFailedError";
}

const CONTAINER_STATES = new Set([
	"running",
	"restarting",
	"exited",
	"created",
]);

const HEALTH_STATES = new Set(["starting", "healthy", "unhealthy"]);

/** Reduces a `docker inspect` result to the health sample the rollout and the post-deploy health watch judge, or a `missing` one for a gone container. */
export function containerSampleFromInspect(
	info: {
		RestartCount?: number;
		State?: {
			ExitCode?: number;
			Health?: { Log?: Array<{ Output?: string }>; Status?: string };
			Status?: string;
		};
	} | null,
): ContainerHealthSample {
	if (!info) {
		return {
			exitCode: null,
			health: "none",
			healthOutput: null,
			kind: "container",
			restartCount: 0,
			state: "missing",
		};
	}
	const status = info.State?.Status ?? "exited";
	const health = info.State?.Health?.Status ?? "none";
	return {
		exitCode: info.State?.ExitCode ?? null,
		health: HEALTH_STATES.has(health)
			? (health as ContainerHealthSample["health"])
			: "none",
		healthOutput: info.State?.Health?.Log?.at(-1)?.Output?.trim() || null,
		kind: "container",
		restartCount: info.RestartCount ?? 0,
		state: CONTAINER_STATES.has(status)
			? (status as ContainerHealthSample["state"])
			: "exited",
	};
}
