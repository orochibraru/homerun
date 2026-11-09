import { PipelineRunDTO } from "#lib/dto/pipeline-run-dto.js";
import { PIPELINE_FILTER_KEYS } from "#lib/pipelines/list.js";
import { jsonPage, parseApiListQuery } from "#lib/server/api-pagination.js";

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const paged = await PipelineRunDTO.list(
		null,
		parseApiListQuery(url, PIPELINE_FILTER_KEYS),
	);
	return jsonPage(
		paged.items.map(({ jobs: _jobs, ...run }) => run),
		paged,
	);
};
