import { JobDTO } from "#lib/dto/job-dto.js";
import { jsonPage, parseApiListQuery } from "#lib/server/api-pagination.js";
import { narrowFilter } from "#lib/server/list-query.js";
import type { JobStatus } from "#lib/types.js";

const JOB_STATUSES: JobStatus[] = [
	"queued",
	"running",
	"succeeded",
	"failed",
	"cancelled",
];

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!locals.isAdmin) {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}
	const wanted = (url.searchParams.get("status") ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const statuses = narrowFilter(wanted, JOB_STATUSES);
	if (statuses.length !== wanted.length) {
		return Response.json(
			{
				error: `Unknown status in "${wanted.join(",")}", expected any of ${JOB_STATUSES.join(", ")}.`,
			},
			{ status: 400 },
		);
	}
	const paged = await JobDTO.listPaged(parseApiListQuery(url), statuses);
	return jsonPage(paged.items, paged);
};
