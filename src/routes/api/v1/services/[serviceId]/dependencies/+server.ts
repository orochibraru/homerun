import {
	ServiceDependencyDTO,
	ServiceDependencyError,
} from "#lib/dto/service-dependency-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { serviceDependenciesApiBody } from "#lib/server/validation/api.js";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!(await ServiceDTO.get(params.serviceId))) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	return Response.json(await ServiceDependencyDTO.describe(params.serviceId));
};

export const PUT = async ({ params, locals, request }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!(await ServiceDTO.get(params.serviceId))) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const result = serviceDependenciesApiBody.safeParse(
		await request.json().catch(() => null),
	);
	if (!result.success) {
		return Response.json(
			{ error: "Invalid request body", issues: result.error.flatten() },
			{ status: 400 },
		);
	}
	try {
		await ServiceDependencyDTO.replace(params.serviceId, result.data.dependsOn);
	} catch (err) {
		if (err instanceof ServiceDependencyError) {
			return Response.json({ error: err.message }, { status: 400 });
		}
		throw err;
	}
	return Response.json(await ServiceDependencyDTO.describe(params.serviceId));
};
