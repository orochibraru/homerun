import { BuildCacheRegistryDTO } from "#lib/dto/build-cache-registry-dto.js";
import { buildCacheRegistryApiJson } from "#lib/server/api-json.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { updateBuildCacheRegistryApiBody } from "#lib/server/validation/api-resources.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const registry = await BuildCacheRegistryDTO.get(params.registryId);
	return registry
		? Response.json(buildCacheRegistryApiJson(registry.toJSON()))
		: apiError("Not found", 404);
};

export const PATCH = async ({ locals, params, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const registry = await BuildCacheRegistryDTO.get(params.registryId);
	if (!registry) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, updateBuildCacheRegistryApiBody);
	if ("response" in body) {
		return body.response;
	}
	const current = registry.toJSON();
	await registry.update({
		name: body.data.name ?? current.name,
		password: body.data.password,
		registryUrl: body.data.registryUrl ?? current.registryUrl,
		username: body.data.username ?? current.username,
	});
	return Response.json(buildCacheRegistryApiJson(registry.toJSON()));
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const registry = await BuildCacheRegistryDTO.get(params.registryId);
	if (!registry) {
		return apiError("Not found", 404);
	}
	await registry.delete();
	return new Response(null, { status: 204 });
};
