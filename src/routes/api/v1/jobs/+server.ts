import { json } from "@sveltejs/kit";
import { JobDTO } from "$lib/dto/job-dto";
import { jsonPage, parseApiListQuery } from "$lib/server/api-pagination";
import { narrowFilter } from "$lib/server/list-query";
import type { JobStatus } from "$lib/types";

const JOB_STATUSES: JobStatus[] = [
	"queued",
	"running",
	"succeeded",
	"failed",
	"cancelled",
];

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!locals.isAdmin) {
		return json({ error: "Forbidden" }, { status: 403 });
	}
	const wanted = (url.searchParams.get("status") ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const statuses = narrowFilter(wanted, JOB_STATUSES);
	if (statuses.length !== wanted.length) {
		return json(
			{
				error: `Unknown status in "${wanted.join(",")}", expected any of ${JOB_STATUSES.join(", ")}.`,
			},
			{ status: 400 },
		);
	}
	const paged = await JobDTO.listPaged(parseApiListQuery(url), statuses);
	return jsonPage(paged.items, paged);
};
