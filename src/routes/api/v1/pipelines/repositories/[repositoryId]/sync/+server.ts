import { RepositoryDTO } from "#lib/dto/repository-dto.js";
import { PipelineService } from "#lib/services/pipeline.service.js";

export const POST = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const repo = await RepositoryDTO.get(params.repositoryId);
	if (!repo) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	return Response.json(
		{ jobId: await PipelineService.enqueueSync(repo, locals.user.id) },
		{ status: 202 },
	);
};
