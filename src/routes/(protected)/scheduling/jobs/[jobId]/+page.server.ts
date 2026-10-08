import { error } from "@sveltejs/kit";
import { describeCleanupResult } from "#lib/cleanup-result.js";
import { JobDTO } from "#lib/dto/job-dto.js";

export const load = async ({ params }) => {
	const job = await JobDTO.get(params.jobId);
	if (!job) {
		error(404, "That job doesn't exist, or it was pruned from the queue.");
	}
	const row = job.toJSON();
	return {
		job: {
			attempts: row.attempts,
			createdAt: row.createdAt,
			error: row.error,
			finishedAt: row.finishedAt,
			id: row.id,
			log: row.log,
			maxAttempts: row.maxAttempts,
			stage: row.stage,
			startedAt: row.startedAt,
			status: row.status,
			summary:
				row.type === "docker_cleanup"
					? describeCleanupResult(row.result)
					: null,
			title: row.title,
			type: row.type,
			workerVersion: row.workerVersion,
		},
	};
};
