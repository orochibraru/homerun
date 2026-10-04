import type { JobSummary } from "#lib/types.js";

export interface UpdatePreflight {
	blockers: JobSummary[];
	pendingDeploys: number;
	reason: string | null;
	ready: boolean;
	runningJobs: number;
	supported: boolean;
}

export const UNSUPPORTED_REASON =
	"Homerun isn't running as a Docker Compose service here, so it can't update itself. Pull the new image and restart it the way you started it.";

/**
 * Whether a self-update can start, from whether this app runs as a Compose
 * service and the jobs `JobDTO.listUpdateBlockers` found: not while a deploy
 * is queued or running, nor while any job runs. The reason names how many
 * of them look stuck, since those won't finish by waiting.
 */
export function preflightFrom(
	supported: boolean,
	blockers: JobSummary[],
): UpdatePreflight {
	const pendingDeploys = blockers.filter(
		(entry) => entry.type === "deploy",
	).length;
	const runningJobs = blockers.filter(
		(entry) => entry.status === "running",
	).length;
	const base = { blockers, pendingDeploys, runningJobs, supported };
	if (!supported) {
		return { ...base, ready: false, reason: UNSUPPORTED_REASON };
	}
	const stale = blockers.filter((entry) => entry.stale).length;
	const stuck = stale > 0 ? ` ${stale} of them look stuck.` : "";
	if (pendingDeploys > 0) {
		return {
			...base,
			ready: false,
			reason: `${pendingDeploys} deployment(s) are queued or running.${stuck} Wait for them to finish, or update anyway.`,
		};
	}
	if (runningJobs > 0) {
		return {
			...base,
			ready: false,
			reason: `${runningJobs} job(s) are running.${stuck} Wait for them to finish, or update anyway.`,
		};
	}
	return { ...base, ready: true, reason: null };
}

/**
 * Why `SelfUpdateService.start` must refuse, or null to go ahead. `force`
 * overrides the jobs (queued or running deploys, running jobs, the job worker
 * still busy), never an install that can't update itself.
 */
export function startRefusal(
	check: UpdatePreflight,
	options: { busy: boolean; force: boolean },
): string | null {
	if (!check.supported) {
		return check.reason ?? UNSUPPORTED_REASON;
	}
	if (options.force) {
		return null;
	}
	if (!check.ready) {
		return check.reason ?? "Homerun can't update right now.";
	}
	if (options.busy) {
		return "A job is still running. Try again in a moment.";
	}
	return null;
}

/** One line per job a forced update runs over, for the log. */
export function describeBlockers(blockers: JobSummary[]): string {
	return blockers
		.map(
			(entry) =>
				`${entry.type} ${entry.id} "${entry.title}" ${entry.status}${entry.stage ? `/${entry.stage}` : ""}${entry.stale ? " (stale)" : ""}`,
		)
		.join("; ");
}
