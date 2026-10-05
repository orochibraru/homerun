import { ServiceDependencyDTO } from "#lib/dto/service-dependency-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { serviceDependencyApiBody } from "#lib/server/validation/api-resources.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	return Response.json(
		(await ServiceDependencyDTO.list()).map((dependency) =>
			dependency.toJSON(),
		),
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, serviceDependencyApiBody);
	if ("response" in body) {
		return body.response;
	}
	const { dependsOnId, serviceId } = body.data;
	const [svc, dependsOn] = await Promise.all([
		ServiceDTO.get(serviceId),
		ServiceDTO.get(dependsOnId),
	]);
	if (!(svc && dependsOn)) {
		return apiError("Both services must exist.", 404);
	}
	try {
		const dependency = await ServiceDependencyDTO.add(serviceId, dependsOnId);
		return Response.json(dependency.toJSON(), { status: 201 });
	} catch (err) {
		return apiError(err instanceof Error ? err.message : String(err));
	}
};
