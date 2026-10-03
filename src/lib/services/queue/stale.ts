import type { JobStage, JobStatus } from "#lib/types.js";

export const STALE_JOB_MS = 2 * 60 * 1000;

export const STALE_PROGRESS_MS = 15 * 60 * 1000;

/**
 * Whether a job is running in the Go worker's `execute` stage but has
 * stopped moving: either no live worker is behind it (its last heartbeat, or
 * its claim when no worker ever leased it, is older than `STALE_JOB_MS`,
 * twelve missed 10s heartbeats, twice the 60s lease), or a worker still
 * heartbeats it but it has made no progress (no Docker call answered, no byte
 * moved) for `STALE_PROGRESS_MS`, the worker's own no-progress watchdog
 * window. Jobs in the app's own stages are never stale: the job worker
 * requeues those as soon as nothing in the process is running them.
 */
export function isStaleJob(
	entry: {
		heartbeatAt: Date | null;
		progressAt?: Date | null;
		stage: JobStage | null;
		startedAt: Date | null;
		status: JobStatus;
	},
	now = Date.now(),
): boolean {
	if (entry.status !== "running" || entry.stage !== "execute") {
		return false;
	}
	const lastSign = entry.heartbeatAt ?? entry.startedAt;
	if (lastSign !== null && lastSign.getTime() < now - STALE_JOB_MS) {
		return true;
	}
	const progressAt = entry.progressAt ?? null;
	return progressAt !== null && progressAt.getTime() < now - STALE_PROGRESS_MS;
}
