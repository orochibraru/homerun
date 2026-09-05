import { json } from "@sveltejs/kit";
import { ProjectDTO } from "$lib/dto/project-dto";
import { Logger } from "$lib/logger";
import { jsonPage, parseApiListQuery } from "$lib/server/api-pagination";
import { createProjectApiBody } from "$lib/server/validation/api";

const logger = new Logger("API");

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const paged = await ProjectDTO.listWithServiceCountsPaged(
		locals.user.id,
		parseApiListQuery(url),
	);
	return jsonPage(
		paged.items.map((r) => r.project.toJSON()),
		paged,
	);
};

export const POST = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await request.json().catch(() => null);
	const result = createProjectApiBody.safeParse(body);
	if (!result.success) {
		return json(
			{ error: "Invalid request body", issues: result.error.flatten() },
			{ status: 400 },
		);
	}
	const input = result.data;

	if (await ProjectDTO.slugTaken(input.slug)) {
		return json({ error: "That slug is already in use." }, { status: 409 });
	}

	const proj = await ProjectDTO.create({
		description: input.description ?? null,
		name: input.name,
		slug: input.slug,
		userId: locals.user.id,
	});

	logger.info(
		`Project created via API: project=${proj.id} user=${locals.user.id}`,
	);
	return json(proj.toJSON(), { status: 201 });
};
