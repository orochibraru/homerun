import { json } from "@sveltejs/kit";
import { RedirectDTO } from "$lib/dto/redirect-dto";
import { Logger } from "$lib/logger";
import { jsonPage, parseApiListQuery } from "$lib/server/api-pagination";
import { parseRedirectInput } from "$lib/server/redirect-form";
import { redirectApiBody } from "$lib/server/validation/api";
import { RedirectService } from "$lib/services/redirect.service";

const logger = new Logger("API");

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const paged = await RedirectDTO.listPaged(parseApiListQuery(url));
	return jsonPage(
		paged.items.map((r) => r.toJSON()),
		paged,
	);
};

export const POST = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const body = redirectApiBody.safeParse(
		await request.json().catch(() => null),
	);
	if (!body.success) {
		return json(
			{ error: "Invalid request body", issues: body.error.flatten() },
			{ status: 400 },
		);
	}
	const result = await parseRedirectInput({
		enabled: true,
		keepPath: true,
		permanent: true,
		...body.data,
	});
	if ("error" in result) {
		return json({ error: result.error }, { status: 400 });
	}
	const created = await RedirectDTO.create({
		...result.fields,
		userId: locals.user.id,
	});
	await RedirectService.sync();
	logger.info(
		`Redirect created via API: redirect=${created.toJSON().id} user=${locals.user.id}`,
	);
	return json(created.toJSON(), { status: 201 });
};
