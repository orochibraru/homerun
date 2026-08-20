import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { deployService } from "$lib/server/deploy";

export const POST = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}

	const result = await deployService(svc, locals.user.id);
	if (!result.success) {
		return json(
			{ deploymentId: result.deploymentId, error: result.error },
			{ status: 500 },
		);
	}
	return json(result);
};
