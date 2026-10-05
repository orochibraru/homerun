import { gitProviderApiJson } from "#lib/server/api-json.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { updateGitProviderApiBody } from "#lib/server/validation/api-resources.js";
import {
	GitProviderConfigError,
	GitProviderConfigService,
} from "#lib/services/git-provider-config.service.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const provider = await GitProviderConfigService.get(params.providerId);
	return provider
		? Response.json(gitProviderApiJson(provider))
		: apiError("Not found", 404);
};

export const PATCH = async ({ locals, params, request }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	if (!(await GitProviderConfigService.get(params.providerId))) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, updateGitProviderApiBody);
	if ("response" in body) {
		return body.response;
	}
	try {
		const provider = await GitProviderConfigService.update(
			params.providerId,
			body.data,
		);
		return Response.json(gitProviderApiJson(provider));
	} catch (err) {
		if (err instanceof GitProviderConfigError) {
			return apiError(err.message);
		}
		throw err;
	}
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	if (!(await GitProviderConfigService.get(params.providerId))) {
		return apiError("Not found", 404);
	}
	await GitProviderConfigService.remove(params.providerId, caller.userId);
	return new Response(null, { status: 204 });
};
