import type { WorkloadHealthSample } from "$lib/revisions";

export type ContainerHealthSample = Extract<
	WorkloadHealthSample,
	{ kind: "container" }
>;

export const ROLLOUT_POLL_MS = 2000;

export interface RolloutWindow {
	maxWaitMs: number;
	settleMs: number;
}

export const ROLLOUT_WINDOW: RolloutWindow = {
	maxWaitMs: 5 * 60 * 1000,
	settleMs: 5000,
};

export const SWARM_UPDATE_MAX_WAIT_MS = 10 * 60 * 1000;
export const SWARM_UPDATE_MONITOR_NS = 15_000_000_000;

export type RolloutStrategy =
	| { kind: "blue-green" }
	| { kind: "recreate"; reason: string | null };

export type ReadinessVerdict =
	| { reason: string; verdict: "failed" }
	| { verdict: "pending" }
	| { verdict: "ready" };

export type SwarmUpdateOutcome =
	| { reason: string; state: "failed" }
	| { state: "completed" }
	| { state: "pending" };

export interface SwarmUpdateStatus {
	Message?: string;
	StartedAt?: string;
	State?: string;
}

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
const SWARM_FAILED_STATES = new Set([
	"paused",
	"rollback_started",
	"rollback_paused",
	"rollback_completed",
]);

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

/**
 * Whether a redeploy can start the new container next to the running one and
 * only then remove it, or has to stop the old one first: nothing to keep
 * serving, host networking (both copies would bind the same ports) and
 * writable volumes (two copies writing the same data) all recreate.
 */
export function rolloutStrategy(input: {
	hasRunningPrevious: boolean;
	networkMode?: "bridge" | "host";
	volumes?: Array<{ readOnly: boolean }>;
}): RolloutStrategy {
	if (!input.hasRunningPrevious) {
		return { kind: "recreate", reason: null };
	}
	if (input.networkMode === "host") {
		return {
			kind: "recreate",
			reason:
				"Host networking can't run two copies side by side, so the previous container stops first.",
		};
	}
	if ((input.volumes ?? []).some((volume) => !volume.readOnly)) {
		return {
			kind: "recreate",
			reason:
				"A writable volume can't safely be shared by two copies, so the previous container stops first.",
		};
	}
	return { kind: "blue-green" };
}

/**
 * Judges whether a freshly started container can take over from the previous
 * one: ready once its healthcheck passes, or, with no healthcheck, once it has
 * kept running for the settle period; failed as soon as it exits, restarts,
 * disappears or reports unhealthy, or when it still isn't ready by the max wait.
 */
export function readinessVerdict(
	sample: ContainerHealthSample,
	elapsedMs: number,
	window: RolloutWindow = ROLLOUT_WINDOW,
): ReadinessVerdict {
	if (sample.state === "missing") {
		return { reason: "The new container disappeared.", verdict: "failed" };
	}
	if (sample.state === "exited") {
		return {
			reason: `The new container exited with code ${sample.exitCode ?? "unknown"}.`,
			verdict: "failed",
		};
	}
	if (sample.state === "restarting" || sample.restartCount > 0) {
		return { reason: "The new container keeps restarting.", verdict: "failed" };
	}
	if (sample.health === "unhealthy") {
		return {
			reason: `The new container's healthcheck failed${sample.healthOutput ? `: ${sample.healthOutput}` : "."}`,
			verdict: "failed",
		};
	}
	if (sample.health === "healthy") {
		return { verdict: "ready" };
	}
	if (
		sample.health === "none" &&
		sample.state === "running" &&
		elapsedMs >= window.settleMs
	) {
		return { verdict: "ready" };
	}
	if (elapsedMs >= window.maxWaitMs) {
		return {
			reason: `The new container wasn't ready after ${Math.round(window.maxWaitMs / 1000)}s.`,
			verdict: "failed",
		};
	}
	return { verdict: "pending" };
}

/** Swarm's update ordering for a service: start the new task before stopping the old one, unless it mounts a writable volume. */
export function swarmUpdateOrder(
	volumes: Array<{ readOnly: boolean }> | undefined,
): "start-first" | "stop-first" {
	return (volumes ?? []).some((volume) => !volume.readOnly)
		? "stop-first"
		: "start-first";
}

/**
 * Reads a swarm service's `UpdateStatus` after this deploy asked for an update:
 * pending until an update newer than `previousStartedAt` shows up and finishes,
 * failed when swarm paused it or rolled it back.
 */
export function swarmUpdateOutcome(
	status: SwarmUpdateStatus | undefined,
	previousStartedAt: string | null,
): SwarmUpdateOutcome {
	if (!status?.State || (status.StartedAt ?? null) === previousStartedAt) {
		return { state: "pending" };
	}
	if (status.State === "completed") {
		return { state: "completed" };
	}
	if (SWARM_FAILED_STATES.has(status.State)) {
		return {
			reason: `The new swarm tasks didn't become healthy, so swarm kept the previous ones${status.Message ? `: ${status.Message}` : "."}`,
			state: "failed",
		};
	}
	return { state: "pending" };
}
