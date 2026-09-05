import { query } from "$app/server";
import { JobDTO } from "$lib/dto/job-dto";
import { requireUser } from "$lib/server/remote-auth";
import type { JobStatus, JobType } from "$lib/types";

export interface QueuedJob {
	attempts: number;
	error: string | null;
	finishedAt: Date | null;
	id: string;
	maxAttempts: number;
	status: JobStatus;
	title: string;
	type: JobType;
}

export interface JobQueueSnapshot {
	active: QueuedJob[];
	recent: QueuedJob[];
}

function toQueuedJob(entry: JobDTO): QueuedJob {
	const row = entry.toJSON();
	return {
		attempts: row.attempts,
		error: row.error,
		finishedAt: row.finishedAt,
		id: row.id,
		maxAttempts: row.maxAttempts,
		status: row.status,
		title: row.title,
		type: row.type,
	};
}

export const getJobQueue = query(async (): Promise<JobQueueSnapshot> => {
	const user = requireUser();
	const [active, recent] = await Promise.all([
		JobDTO.listActive(user.id),
		JobDTO.listRecent(user.id),
	]);
	return {
		active: active.map(toQueuedJob),
		recent: recent.map(({ job }) => toQueuedJob(job)),
	};
});
