import type { ContainerStatus, JobStatus, JobType } from "#lib/types.js";

export interface ActivityDeployment {
	createdAt: string;
	environment: string;
	errorMessage: string | null;
	finishedAt: string | null;
	gitCommit: string | null;
	id: string;
	imageRef: string | null;
	lastLine: string | null;
	serviceId: string;
	serviceName: string;
	serviceSlug: string;
	startedAt: string | null;
	status: ContainerStatus;
	trigger: string | null;
}

export interface ActivityJob {
	createdAt: string;
	id: string;
	serviceId: string | null;
	startedAt: string | null;
	status: JobStatus;
	title: string;
	type: JobType;
}

export interface ActivityAlert {
	at: string;
	count: number;
	detail: string | null;
	id: string;
	kind: "issue" | "log";
	serviceId: string;
	serviceName: string;
	title: string;
}

export interface ActivitySnapshot {
	alerts: ActivityAlert[];
	at: string;
	deploying: ActivityDeployment[];
	jobs: ActivityJob[];
	recent: ActivityDeployment[];
}

/** The last non-empty line of a deploy's progress log, or null when it hasn't written one. */
export function lastLogLine(log: string | null): string | null {
	if (!log) {
		return null;
	}
	const lines = log.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]?.trim();
		if (line) {
			return line;
		}
	}
	return null;
}

/** Whole seconds from `from` to `to` (now when unset), never below zero. */
export function elapsedSeconds(
	from: string,
	to: string | null,
	now: number,
): number {
	const end = to ? new Date(to).getTime() : now;
	return Math.max(0, Math.round((end - new Date(from).getTime()) / 1000));
}

/** A duration in seconds as `42s`, `3m 05s` or `1h 12m`. */
export function formatElapsed(seconds: number): string {
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
	}
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
