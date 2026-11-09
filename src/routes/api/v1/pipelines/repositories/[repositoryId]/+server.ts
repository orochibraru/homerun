import { RepositoryDTO } from "#lib/dto/repository-dto.js";
import { Logger } from "#lib/logger.js";
import { PipelineService } from "#lib/services/pipeline.service.js";

const logger = new Logger("API");

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const repo = await RepositoryDTO.get(params.repositoryId);
	if (!repo) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const [overview, linkedServices] = await Promise.all([
		PipelineService.overview(repo),
		repo.linkedServices(),
	]);
	return Response.json({
		...repo.toJSON(),
		allTimeStats: overview.allTime,
		linkedServices,
		rates: overview.rates,
		ratesCustom: overview.ratesCustom,
		stats: overview.window,
		workflows: overview.workflows,
	});
};

export const DELETE = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const repo = await RepositoryDTO.get(params.repositoryId);
	if (!repo) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	await PipelineService.unwatch(repo);
	logger.info(
		`Repository unwatched via API: repository=${repo.id} user=${locals.user.id}`,
	);
	return Response.json({ success: true });
};
