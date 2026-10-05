import { StackDTO } from "#lib/dto/stack-dto.js";
import { jsonPage, parseApiListQuery } from "#lib/server/api-pagination.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { createStackApiBody } from "#lib/server/validation/api.js";
import {
	StackSettingsError,
	StackSettingsService,
} from "#lib/services/stack-settings.service.js";

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
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
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, createStackApiBody);
	if ("response" in body) {
		return body.response;
	}
	try {
		const stack = await StackSettingsService.create(body.data, caller.userId);
		return Response.json(stack.toJSON(), { status: 201 });
	} catch (err) {
		if (err instanceof StackSettingsError) {
			return apiError(err.message, 409);
		}
		throw err;
	}
};
