import { BackupRunDTO } from "#lib/dto/backup-run-dto.js";
import { JobDTO } from "#lib/dto/job-dto.js";
import { jsonPage, parseApiListQuery } from "#lib/server/api-pagination.js";

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const paged = await BackupRunDTO.listPaged(
		parseApiListQuery(url, ["kind", "outcome", "volume"]),
	);
	const jobs = await JobDTO.progressFor(
		paged.items.map(({ run }) => run.toJSON().jobId),
	);
	return jsonPage(
		paged.items.map(({ run, volumeName }) => {
			const row = run.toJSON();
			const job = row.jobId ? jobs.get(row.jobId) : undefined;
			return {
				...row,
				jobAttempts: job?.attempts ?? null,
				jobProgressAt: job?.progressAt ?? null,
				jobStatus: job?.status ?? null,
				volumeName,
			};
		}),
		paged,
	);
};
