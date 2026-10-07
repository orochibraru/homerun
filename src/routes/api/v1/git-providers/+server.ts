import { gitProviderApiJson } from "#lib/server/api-json.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { gitProviderApiBody } from "#lib/server/validation/api-resources.js";
import {
	GitProviderConfigError,
	GitProviderConfigService,
} from "#lib/services/git-provider-config.service.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	return Response.json(
		(await GitProviderConfigService.list()).map(gitProviderApiJson),
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, gitProviderApiBody);
	if ("response" in body) {
		return body.response;
	}
	try {
		const provider = await GitProviderConfigService.add(
			body.data,
			caller.userId,
		);
		return Response.json(gitProviderApiJson(provider), { status: 201 });
	} catch (err) {
		if (err instanceof GitProviderConfigError) {
			return apiError(err.message);
		}
		throw err;
	}
};
