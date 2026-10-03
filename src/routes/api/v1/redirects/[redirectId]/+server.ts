import { RedirectDTO } from "#lib/dto/redirect-dto.js";
import { Logger } from "#lib/logger.js";
import { parseRedirectInput } from "#lib/server/redirect-form.js";
import { redirectApiBody } from "#lib/server/validation/api.js";
import {
	RedirectService,
	redirectHost,
} from "#lib/services/redirect.service.js";

const logger = new Logger("API");

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const found = await RedirectDTO.get(params.redirectId);
	if (!found) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	return Response.json(found.toJSON());
};

export const PATCH = async ({ params, request, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const found = await RedirectDTO.get(params.redirectId);
	if (!found) {
		return Response.json({ error: "Not found" }, { status: 404 });
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
	const current = found.toJSON();
	const result = await parseRedirectInput(
		{
			destination: current.destination,
			enabled: current.enabled,
			keepPath: current.keepPath,
			permanent: current.permanent,
			source: current.source,
			...body.data,
		},
		current.id,
	);
	if ("error" in result) {
		return Response.json({ error: result.error }, { status: 400 });
	}
	const host = redirectHost(current.source);
	await found.update(result.fields);
	await RedirectService.sync(host ? [host] : []);
	logger.info(
		`Redirect updated via API: redirect=${current.id} user=${locals.user.id}`,
	);
	return Response.json(found.toJSON());
};

export const DELETE = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const found = await RedirectDTO.get(params.redirectId);
	if (!found) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const host = redirectHost(found.toJSON().source);
	await found.delete();
	await RedirectService.sync(host ? [host] : []);
	logger.info(
		`Redirect deleted via API: redirect=${params.redirectId} user=${locals.user.id}`,
	);
	return Response.json({ success: true });
};
