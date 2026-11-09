import { PipelineRunDTO } from "#lib/dto/pipeline-run-dto.js";
import { RepositoryDTO } from "#lib/dto/repository-dto.js";
import { PIPELINE_FILTER_KEYS } from "#lib/pipelines/list.js";
import { jsonPage, parseApiListQuery } from "#lib/server/api-pagination.js";

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const repo = await RepositoryDTO.get(params.repositoryId);
	if (!repo) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const paged = await PipelineRunDTO.list(
		repo.id,
		parseApiListQuery(url, PIPELINE_FILTER_KEYS),
	);
	return jsonPage(
		paged.items.map(({ jobs: _jobs, ...run }) => run),
		paged,
	);
};
