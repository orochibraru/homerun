import { StatusPageDTO } from "#lib/dto/status-page-dto.js";
import { statusPageApiJson } from "#lib/server/api-json.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { updateStatusPageApiBody } from "#lib/server/validation/api-resources.js";
import {
	StatusPageSettingsError,
	StatusPageSettingsService,
} from "#lib/services/status-page-settings.service.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const page = await StatusPageDTO.get(params.statusPageId);
	return page
		? Response.json(statusPageApiJson(page.toJSON(), await page.picks()))
		: apiError("Not found", 404);
};

export const PATCH = async ({ locals, params, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const page = await StatusPageDTO.get(params.statusPageId);
	if (!page) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, updateStatusPageApiBody);
	if ("response" in body) {
		return body.response;
	}
	const { services, ...fields } = body.data;
	const current = page.toJSON();
	try {
		await StatusPageSettingsService.update(page, {
			description: current.description,
			domains: current.domains,
			isPublic: current.isPublic,
			name: current.name,
			scope: current.scope,
			slug: current.slug,
			stackId: current.stackId,
			...fields,
			picks: services ?? (await page.picks()),
		});
	} catch (err) {
		if (err instanceof StatusPageSettingsError) {
			return apiError(err.message, err.field === "slug" ? 409 : 400);
		}
		throw err;
	}
	return Response.json(statusPageApiJson(page.toJSON(), await page.picks()));
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const page = await StatusPageDTO.get(params.statusPageId);
	if (!page) {
		return apiError("Not found", 404);
	}
	await StatusPageSettingsService.delete(page);
	return new Response(null, { status: 204 });
};
