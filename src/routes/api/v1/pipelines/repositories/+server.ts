import { RepositoryDTO } from "#lib/dto/repository-dto.js";
import { Logger } from "#lib/logger.js";
import { jsonPage, parseApiListQuery } from "#lib/server/api-pagination.js";
import { watchRepositoryApiBody } from "#lib/server/validation/api.js";
import { PipelineService } from "#lib/services/pipeline.service.js";

const logger = new Logger("API");

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const paged = await PipelineService.repositoryPage(parseApiListQuery(url));
	return jsonPage(paged.items, paged);
};

export const POST = async ({ request, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const body = watchRepositoryApiBody.safeParse(
		await request.json().catch(() => null),
	);
	if (!body.success) {
		return Response.json(
			{ error: "Invalid request body", issues: body.error.flatten() },
			{ status: 400 },
		);
	}
	const existing = await RepositoryDTO.getByPath(
		body.data.providerId,
		body.data.fullName,
	);
	try {
		const repo = await PipelineService.watch({
			defaultBranch: body.data.defaultBranch ?? null,
			fullName: body.data.fullName,
			providerId: body.data.providerId,
			userId: locals.user.id,
		});
		logger.info(
			`Repository watched via API: repository=${repo.id} user=${locals.user.id}`,
		);
		return Response.json(
			{ ...repo.toJSON(), linkedServices: await repo.linkedServices() },
			{ status: existing ? 200 : 201 },
		);
	} catch (err) {
		return Response.json(
			{ error: err instanceof Error ? err.message : "Couldn't watch it." },
			{ status: 400 },
		);
	}
};
