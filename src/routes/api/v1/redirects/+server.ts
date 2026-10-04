import { RedirectDTO } from "#lib/dto/redirect-dto.js";
import { Logger } from "#lib/logger.js";
import { jsonPage, parseApiListQuery } from "#lib/server/api-pagination.js";
import { parseRedirectInput } from "#lib/server/redirect-form.js";
import { redirectApiBody } from "#lib/server/validation/api.js";
import { RedirectService } from "#lib/services/redirect.service.js";

const logger = new Logger("API");

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const paged = await RedirectDTO.listPaged(parseApiListQuery(url));
	return jsonPage(
		paged.items.map((r) => r.toJSON()),
		paged,
	);
};

export const POST = async ({ request, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const body = redirectApiBody.safeParse(
		await request.json().catch(() => null),
	);
	if (!body.success) {
		return Response.json(
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
		return Response.json({ error: result.error }, { status: 400 });
	}
	const created = await RedirectDTO.create({
		...result.fields,
		userId: locals.user.id,
	});
	await RedirectService.sync();
	logger.info(
		`Redirect created via API: redirect=${created.toJSON().id} user=${locals.user.id}`,
	);
	return Response.json(created.toJSON(), { status: 201 });
};
