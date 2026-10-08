import { z } from "zod";
import { JOB_TYPE_LABELS } from "#lib/constants.js";
import { JobDTO, type JobListFilter } from "#lib/dto/job-dto.js";
import { requireUser } from "#lib/server/remote-auth.js";
import type { JobStatus, JobType } from "#lib/types.js";
import { query } from "$app/server";

export interface QueuedJob {
	attempts: number;
	error: string | null;
	finishedAt: Date | null;
	id: string;
	maxAttempts: number;
	startedAt: Date | null;
	status: JobStatus;
	title: string;
	type: JobType;
	workerVersion: string | null;
}

export interface JobQueueSnapshot {
	active: QueuedJob[];
	recent: QueuedJob[];
	typeCounts: { count: number; type: JobType }[];
}

function toQueuedJob(entry: JobDTO): QueuedJob {
	const row = entry.toJSON();
	return {
		attempts: row.attempts,
		error: row.error,
		finishedAt: row.finishedAt,
		id: row.id,
		maxAttempts: row.maxAttempts,
		startedAt: row.startedAt,
		status: row.status,
		title: row.title,
		type: row.type,
		workerVersion: row.workerVersion,
	};
}

export const getJobQueue = query(
	z.object({ q: z.string().max(200), types: z.array(z.string()).max(20) }),
	async ({ q, types }): Promise<JobQueueSnapshot> => {
		requireUser();
		const filter: JobListFilter = {
			q,
			types: types.filter((type): type is JobType => type in JOB_TYPE_LABELS),
		};
		const [active, recent, typeCounts] = await Promise.all([
			JobDTO.listActive(filter),
			JobDTO.listRecent(15, filter),
			JobDTO.typeCounts(q),
		]);
		return {
			active: active.map(toQueuedJob),
			recent: recent.map(({ job }) => toQueuedJob(job)),
			typeCounts,
		};
	},
);
