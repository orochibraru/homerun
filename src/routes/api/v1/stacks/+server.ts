import { json } from "@sveltejs/kit";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import { jsonPage, parseApiListQuery } from "$lib/server/api-pagination";
import { createStackApiBody } from "$lib/server/validation/api";

const logger = new Logger("API");

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const paged = await StackDTO.listWithServiceCountsPaged(
		parseApiListQuery(url),
	);
	return jsonPage(
		paged.items.map((r) => r.stack.toJSON()),
		paged,
	);
};

export const POST = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await request.json().catch(() => null);
	const result = createStackApiBody.safeParse(body);
	if (!result.success) {
		return json(
			{ error: "Invalid request body", issues: result.error.flatten() },
			{ status: 400 },
		);
	}
	const input = result.data;

	if (await StackDTO.slugTaken(input.slug)) {
		return json({ error: "That slug is already in use." }, { status: 409 });
	}

	const stack = await StackDTO.create({
		description: input.description ?? null,
		name: input.name,
		slug: input.slug,
		userId: locals.user.id,
	});

	logger.info(
		`Stack created via API: stack=${stack.id} user=${locals.user.id}`,
	);
	return json(stack.toJSON(), { status: 201 });
};
