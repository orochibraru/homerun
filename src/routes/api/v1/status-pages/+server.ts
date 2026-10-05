import { StatusPageDTO } from "#lib/dto/status-page-dto.js";
import { statusPageApiJson } from "#lib/server/api-json.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { statusPageApiBody } from "#lib/server/validation/api-resources.js";
import {
	StatusPageSettingsError,
	StatusPageSettingsService,
} from "#lib/services/status-page-settings.service.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const pages = await StatusPageDTO.list();
	return Response.json(
		await Promise.all(
			pages.map(async (page) =>
				statusPageApiJson(page.toJSON(), await page.picks()),
			),
		),
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, statusPageApiBody);
	if ("response" in body) {
		return body.response;
	}
	const { services, ...fields } = body.data;
	try {
		const page = await StatusPageSettingsService.create(
			{
				...fields,
				description: fields.description ?? null,
				picks: services,
				stackId: fields.stackId ?? null,
			},
			caller.userId,
		);
		return Response.json(statusPageApiJson(page.toJSON(), await page.picks()), {
			status: 201,
		});
	} catch (err) {
		if (err instanceof StatusPageSettingsError) {
			return apiError(err.message, err.field === "slug" ? 409 : 400);
		}
		throw err;
	}
};
