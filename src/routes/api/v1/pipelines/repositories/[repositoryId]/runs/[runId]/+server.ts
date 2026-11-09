import { PipelineRunDTO } from "#lib/dto/pipeline-run-dto.js";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const run = await PipelineRunDTO.getForRepository(
		params.repositoryId,
		params.runId,
	);
	if (!run) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	return Response.json(run.toJSON());
};
