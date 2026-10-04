import { JobDTO } from "#lib/dto/job-dto.js";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const job = await JobDTO.get(params.jobId);
	if (!job) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const row = job.toJSON();
	return Response.json({
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
