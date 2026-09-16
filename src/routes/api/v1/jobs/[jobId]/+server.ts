import { json } from "@sveltejs/kit";
import { JobDTO } from "$lib/dto/job-dto";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const job = await JobDTO.get(params.jobId);
	if (!job || job.userId !== locals.user.id) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const row = job.toJSON();
	return json({
		createdAt: row.createdAt,
		error: row.error,
		finishedAt: row.finishedAt,
		id: row.id,
		result: row.result,
		serviceId: row.serviceId,
		startedAt: row.startedAt,
		status: row.status,
		title: row.title,
		type: row.type,
	});
};
