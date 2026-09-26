import { json } from "@sveltejs/kit";
import {
	ServiceDependencyDTO,
	ServiceDependencyError,
} from "$lib/dto/service-dependency-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { serviceDependenciesApiBody } from "$lib/server/validation/api";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!(await ServiceDTO.get(params.serviceId))) {
		return json({ error: "Not found" }, { status: 404 });
	}
	return json(await ServiceDependencyDTO.describe(params.serviceId));
};

export const PUT = async ({ params, locals, request }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!(await ServiceDTO.get(params.serviceId))) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const result = serviceDependenciesApiBody.safeParse(
		await request.json().catch(() => null),
	);
	if (!result.success) {
		return json(
			{ error: "Invalid request body", issues: result.error.flatten() },
			{ status: 400 },
		);
	}
	try {
		await ServiceDependencyDTO.replace(params.serviceId, result.data.dependsOn);
	} catch (err) {
		if (err instanceof ServiceDependencyError) {
			return json({ error: err.message }, { status: 400 });
		}
		throw err;
	}
	return json(await ServiceDependencyDTO.describe(params.serviceId));
};
