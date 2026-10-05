import { ServiceDependencyDTO } from "#lib/dto/service-dependency-dto.js";
import { apiCaller, apiError } from "#lib/server/api-route.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const dependency = await ServiceDependencyDTO.get(params.dependencyId);
	return dependency
		? Response.json(dependency.toJSON())
		: apiError("Not found", 404);
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const dependency = await ServiceDependencyDTO.get(params.dependencyId);
	if (!dependency) {
		return apiError("Not found", 404);
	}
	await dependency.delete();
	return new Response(null, { status: 204 });
};
