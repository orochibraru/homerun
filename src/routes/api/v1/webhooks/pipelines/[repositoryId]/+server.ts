import { RepositoryDTO } from "#lib/dto/repository-dto.js";
import { PipelineService } from "#lib/services/pipeline.service.js";

export const POST = async ({ params, request }) => {
	const result = await PipelineService.handleWebhook(
		await RepositoryDTO.get(params.repositoryId),
		request.headers,
		await request.text(),
	);
	if (result.status === "rejected") {
		return Response.json({ error: result.reason }, { status: result.code });
	}
	if (result.status === "ignored") {
		return Response.json({ ignored: result.reason }, { status: 202 });
	}
	return Response.json({ jobId: result.jobId }, { status: 202 });
};
