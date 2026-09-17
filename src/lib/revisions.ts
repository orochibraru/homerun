import { splitImageRef } from "$lib/image-ref";
import type { ContainerStatus, RevisionHealth } from "$lib/types";

export const RETAINED_REVISIONS = 5;
export const MIN_RETAINED_IMAGES = 1;
export const MAX_RETAINED_IMAGES = 50;

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

/**
 * Whether a deployment row counts as a revision that can be rolled back to: it
 * recorded an image reference and ended up running or stopped.
 */
export function isRevision(row: RevisionLike): boolean {
	return Boolean(row.imageRef) && REVISION_STATUSES.has(row.status);
}

/**
 * Identifies the image a revision ran, preferring the local image id, then the
 * digest, then the reference, so redeploys of the same image collapse to one key.
 */
export function revisionImageKey(row: RevisionLike): string {
	return row.imageId ?? row.imageDigest ?? row.imageRef ?? row.id;
}

/** Returns a copy of the rows sorted by creation time, newest first. */
export function newestFirst<T extends RevisionLike>(rows: T[]): T[] {
	return [...rows].sort(
		(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
	);
}

/** The newest deployment row that is a revision, or null when there is none. */
export function currentRevision<T extends RevisionLike>(rows: T[]): T | null {
	return newestFirst(rows).find(isRevision) ?? null;
}

/**
 * Finds the rollback target: the newest revision older than the current one that
 * ran a different image and isn't marked unhealthy or rolled back.
 *
 * @param currentId The revision to treat as current; defaults to the newest.
 * @returns null when the current revision isn't found or nothing qualifies.
 */
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

const SUPERSEDED_HEALTH = new Set<RevisionHealth>(["healthy", "watching"]);

/**
 * The health a deployment row keeps once another revision of its service has
 * become current: `healthy` and `watching` only ever describe the running
 * revision, so they're cleared, while `unhealthy` and `rolled_back` stay as
 * history (and keep the row out of `previousRevision`).
 */
export function supersededHealth(
	health: RevisionHealth | null,
): RevisionHealth | null {
	return health && SUPERSEDED_HEALTH.has(health) ? null : health;
}

/** The health states `supersededHealth` clears, for the query that clears them in bulk once a deploy succeeds. */
export const CLEARED_ON_SUPERSEDE: RevisionHealth[] = [...SUPERSEDED_HEALTH];

/**
 * Follows a row's `rollbackOfDeploymentId` chain to the original deploy it
 * redeployed, so every redeploy of one revision resolves to the same row.
 * Stops at the last row it can find in `rows` (a rollback whose target isn't
 * loaded is its own root) and never loops on a cycle.
 */
export function revisionRoot<T extends RevisionLike>(rows: T[], row: T): T {
	const byId = new Map(rows.map((candidate) => [candidate.id, candidate]));
	const seen = new Set<string>([row.id]);
	let root = row;
	while (root.rollbackOfDeploymentId) {
		const parent = byId.get(root.rollbackOfDeploymentId);
		if (!parent || seen.has(parent.id)) {
			break;
		}
		seen.add(parent.id);
		root = parent;
	}
	return root;
}

export interface RevisionEntry<T extends RevisionLike> {
	current: boolean;
	health: RevisionHealth | null;
	lastDeployed: T | null;
	latest: T;
	previous: boolean;
	redeployCount: number;
	retained: boolean;
	revision: T;
}

/**
 * Collapses deployment rows into one entry per revision for the Revisions
 * list: a rollback or redeploy folds into the revision it redeployed instead
 * of becoming a new entry, so the list keeps the order revisions were first
 * deployed in (newest first) and only the markers move. Each entry carries its
 * original row, its latest attempt (whose status, log and error the list
 * shows) and its latest successful run (when it last went live). Its health
 * is that run's, passed through `supersededHealth` unless it's the current
 * revision, so a row recorded before superseded health was cleared in the
 * database still never shows a stale `healthy`.
 *
 * @param options.deployed Whether the service has a running workload; without
 *   one nothing is current.
 * @param options.retainedLimit How many distinct images per service are kept.
 */
export function revisionEntries<T extends RevisionLike>(
	rows: T[],
	options: { deployed: boolean; retainedLimit: number },
): RevisionEntry<T>[] {
	const ordered = newestFirst(rows);
	const groups = new Map<string, { root: T; runs: T[] }>();
	for (const row of ordered) {
		const root = revisionRoot(ordered, row);
		const group = groups.get(root.id) ?? { root, runs: [] };
		group.runs.push(row);
		groups.set(root.id, group);
	}
	const revisions = ordered.filter(isRevision);
	const currentRow = options.deployed ? (revisions[0] ?? null) : null;
	const currentRoot = currentRow ? revisionRoot(ordered, currentRow) : null;
	const previousRow = currentRow
		? previousRevision(revisions, currentRow.id)
		: null;
	const previousRoot = previousRow ? revisionRoot(ordered, previousRow) : null;
	const retainedKeys = new Set(
		retainedRevisions(revisions, options.retainedLimit).map(revisionImageKey),
	);
	return [...groups.values()]
		.sort((a, b) => b.root.createdAt.getTime() - a.root.createdAt.getTime())
		.map(({ root, runs }) => {
			const lastDeployed = runs.find(isRevision) ?? null;
			const current = root.id === currentRoot?.id;
			const health = lastDeployed?.health ?? null;
			return {
				current,
				health: current ? health : supersededHealth(health),
				lastDeployed,
				latest: runs[0] ?? root,
				previous:
					root.id === previousRoot?.id && previousRoot.id !== currentRoot?.id,
				redeployCount: runs.filter((run) => run.id !== root.id).length,
				retained: lastDeployed
					? retainedKeys.has(revisionImageKey(lastDeployed))
					: false,
				revision: root,
			};
		});
}

/**
 * Selects the revisions whose images are kept on the host: per service, the
 * newest revision of each distinct image, up to `limit` distinct images.
 */
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

/**
 * Lists every reference a revision's image may still be found under on the
 * host (image id, `image@digest`, and `image:tag` for git builds or undigested
 * images), so image cleanup can tell which images a retained revision needs.
 */
export function revisionImageRefs(row: RevisionLike): string[] {
	if (!row.imageRef) {
		return row.imageId ? [row.imageId] : [];
	}
	const { image, tag } = splitImageRef(row.imageRef);
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

/**
 * Judges a single container's health after a deploy: unhealthy at once if it
 * vanished, exited, fails its healthcheck or restarted repeatedly since the
 * baseline; pending until the observation window ends, and while it's still
 * starting up to the max wait; healthy otherwise.
 */
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

/**
 * Judges a swarm service's health after a deploy: unhealthy once enough tasks
 * have failed, pending until the observation window ends, healthy when all
 * desired tasks run, and unhealthy if they still don't by the max wait.
 */
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

/**
 * Decides whether a freshly deployed workload is healthy, unhealthy (with a
 * reason, which triggers auto-rollback) or still pending, by comparing a sample
 * against the one taken right after the deploy.
 *
 * @param baseline The sample taken at deploy time; restart counts are measured
 * relative to it.
 * @param elapsedMs Time since the deploy.
 */
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
