import { json } from "@sveltejs/kit";
import { z } from "zod";
import { ProjectDTO } from "$lib/dto/project-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("API");

const SLUG_RE = /^[a-z0-9-]{1,63}$/;

const createProjectBody = z.object({
	description: z.string().optional(),
	name: z.string().min(1).max(100),
	slug: z.string().regex(SLUG_RE),
});

export const GET = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const projects = await ProjectDTO.list(locals.user.id);
	return json(projects.map((p) => p.toJSON()));
};

export const POST = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await request.json().catch(() => null);
	const result = createProjectBody.safeParse(body);
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
