import type { ContainerStatus, RevisionHealth } from "$lib/types";

export const RETAINED_REVISIONS = 5;

export interface RevisionLike {
	buildSource: "image" | "git" | null;
	createdAt: Date;
	health: RevisionHealth | null;
	id: string;
	imageDigest: string | null;
	imageId: string | null;
	imageRef: string | null;
	rollbackOfDeploymentId: string | null;
	serviceId: string;
	status: ContainerStatus;
}

const REVISION_STATUSES = new Set<ContainerStatus>(["running", "stopped"]);
const UNHEALTHY = new Set<RevisionHealth>(["unhealthy", "rolled_back"]);

export function isRevision(row: RevisionLike): boolean {
	return Boolean(row.imageRef) && REVISION_STATUSES.has(row.status);
}

export function revisionImageKey(row: RevisionLike): string {
	return row.imageId ?? row.imageDigest ?? row.imageRef ?? row.id;
}

export function newestFirst<T extends RevisionLike>(rows: T[]): T[] {
	return [...rows].sort(
		(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
	);
}

export function currentRevision<T extends RevisionLike>(rows: T[]): T | null {
	return newestFirst(rows).find(isRevision) ?? null;
}

export function previousRevision<T extends RevisionLike>(
	rows: T[],
	currentId: string | null = null,
): T | null {
	const revisions = newestFirst(rows).filter(isRevision);
	const current = currentId
		? revisions.find((row) => row.id === currentId)
		: revisions[0];
	if (!current) {
		return null;
	}
	const currentKey = revisionImageKey(current);
	return (
		revisions.find(
			(row) =>
				row.createdAt.getTime() < current.createdAt.getTime() &&
				revisionImageKey(row) !== currentKey &&
				!(row.health && UNHEALTHY.has(row.health)),
		) ?? null
	);
}

export function retainedRevisions<T extends RevisionLike>(
	rows: T[],
	limit = RETAINED_REVISIONS,
): T[] {
	const kept: T[] = [];
	const perService = new Map<string, Set<string>>();
	for (const row of newestFirst(rows)) {
		if (!isRevision(row)) {
			continue;
		}
		const keys = perService.get(row.serviceId) ?? new Set<string>();
		const key = revisionImageKey(row);
		if (keys.has(key)) {
			continue;
		}
		if (keys.size >= limit) {
			continue;
		}
		keys.add(key);
		perService.set(row.serviceId, keys);
		kept.push(row);
	}
	return kept;
}

export function splitRevisionRef(imageRef: string): {
	image: string;
	tag: string;
} {
	const bare = imageRef.split("@")[0] ?? imageRef;
	const colon = bare.lastIndexOf(":");
	if (colon > bare.lastIndexOf("/")) {
		return { image: bare.slice(0, colon), tag: bare.slice(colon + 1) };
	}
	return { image: bare, tag: "latest" };
}

export function revisionImageRefs(row: RevisionLike): string[] {
	if (!row.imageRef) {
		return row.imageId ? [row.imageId] : [];
	}
	const { image, tag } = splitRevisionRef(row.imageRef);
	const refs: string[] = [];
	if (row.imageId) {
		refs.push(row.imageId);
	}
	if (row.imageDigest) {
		refs.push(`${image}@${row.imageDigest}`);
	}
	if (row.buildSource === "git" || !row.imageDigest) {
		refs.push(`${image}:${tag}`);
	}
	return refs;
}

export type WorkloadHealthSample =
	| {
			exitCode: number | null;
			health: "none" | "starting" | "healthy" | "unhealthy";
			healthOutput: string | null;
			kind: "container";
			restartCount: number;
			state: "running" | "restarting" | "exited" | "created" | "missing";
	  }
	| {
			desired: number;
			failed: number;
			kind: "swarm";
			lastError: string | null;
			running: number;
	  };

export interface HealthWindow {
	maxWaitMs: number;
	windowMs: number;
}

export const HEALTH_WINDOW: HealthWindow = {
	maxWaitMs: 5 * 60 * 1000,
	windowMs: 90 * 1000,
};

export const RESTART_LOOP_THRESHOLD = 2;
export const SWARM_FAILED_TASK_THRESHOLD = 2;

export type HealthVerdict =
	| { reason: string; verdict: "unhealthy" }
	| { verdict: "healthy" }
	| { verdict: "pending" };

function containerVerdict(
	baseline: Extract<WorkloadHealthSample, { kind: "container" }>,
	sample: Extract<WorkloadHealthSample, { kind: "container" }>,
	elapsedMs: number,
	window: HealthWindow,
): HealthVerdict {
	if (sample.state === "missing") {
		return { reason: "The container disappeared.", verdict: "unhealthy" };
	}
	const restarts = sample.restartCount - baseline.restartCount;
	if (restarts >= RESTART_LOOP_THRESHOLD) {
		return {
			reason: `The container restarted ${restarts} times (restart loop).`,
			verdict: "unhealthy",
		};
	}
	if (sample.state === "exited") {
		return {
			reason: `The container exited with code ${sample.exitCode ?? "unknown"}.`,
			verdict: "unhealthy",
		};
	}
	if (sample.health === "unhealthy") {
		return {
			reason: `The healthcheck is failing${sample.healthOutput ? `: ${sample.healthOutput}` : "."}`,
			verdict: "unhealthy",
		};
	}
	if (elapsedMs < window.windowMs) {
		return { verdict: "pending" };
	}
	if (sample.health === "starting" || sample.state === "restarting") {
		return elapsedMs < window.maxWaitMs
			? { verdict: "pending" }
			: {
					reason: "The healthcheck never passed.",
					verdict: "unhealthy",
				};
	}
	return { verdict: "healthy" };
}

function swarmVerdict(
	sample: Extract<WorkloadHealthSample, { kind: "swarm" }>,
	elapsedMs: number,
	window: HealthWindow,
): HealthVerdict {
	if (sample.failed >= SWARM_FAILED_TASK_THRESHOLD) {
		return {
			reason: `${sample.failed} swarm tasks failed${sample.lastError ? `: ${sample.lastError}` : "."}`,
			verdict: "unhealthy",
		};
	}
	if (elapsedMs < window.windowMs) {
		return { verdict: "pending" };
	}
	if (sample.running >= sample.desired) {
		return { verdict: "healthy" };
	}
	return elapsedMs < window.maxWaitMs
		? { verdict: "pending" }
		: {
				reason: `Only ${sample.running} of ${sample.desired} swarm tasks are running.`,
				verdict: "unhealthy",
			};
}

export function healthVerdict(
	baseline: WorkloadHealthSample,
	sample: WorkloadHealthSample,
	elapsedMs: number,
	window: HealthWindow = HEALTH_WINDOW,
): HealthVerdict {
	if (sample.kind === "swarm") {
		return swarmVerdict(sample, elapsedMs, window);
	}
	const base = baseline.kind === "container" ? baseline : sample;
	return containerVerdict(base, sample, elapsedMs, window);
}
