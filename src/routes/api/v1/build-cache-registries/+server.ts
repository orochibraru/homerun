import { BuildCacheRegistryDTO } from "#lib/dto/build-cache-registry-dto.js";
import { buildCacheRegistryApiJson } from "#lib/server/api-json.js";
import { jsonPage, parseApiListQuery } from "#lib/server/api-pagination.js";
import { apiCaller, readApiBody } from "#lib/server/api-route.js";
import { buildCacheRegistryApiBody } from "#lib/server/validation/api-resources.js";

export const GET = async ({ locals, url }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const paged = await BuildCacheRegistryDTO.listPaged(parseApiListQuery(url));
	return jsonPage(
		paged.items.map((registry) => buildCacheRegistryApiJson(registry.toJSON())),
		paged,
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, buildCacheRegistryApiBody);
	if ("response" in body) {
		return body.response;
	}
	const registry = await BuildCacheRegistryDTO.create({
		...body.data,
		userId: caller.userId,
	});
	return Response.json(buildCacheRegistryApiJson(registry.toJSON()), {
		status: 201,
	});
};
