import { json } from "@sveltejs/kit";
import { JobDTO } from "$lib/dto/job-dto";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const job = await JobDTO.get(params.jobId);
	if (!job) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const row = job.toJSON();
	return json({
		attempts: row.attempts,
		createdAt: row.createdAt,
		error: row.error,
		finishedAt: row.finishedAt,
		heartbeatAt: row.heartbeatAt,
		id: row.id,
		log: row.log,
		maxAttempts: row.maxAttempts,
		progressAt: row.progressAt,
		result: row.result,
		serviceId: row.serviceId,
		stage: row.stage,
		startedAt: row.startedAt,
		status: row.status,
		title: row.title,
		type: row.type,
	});
};
