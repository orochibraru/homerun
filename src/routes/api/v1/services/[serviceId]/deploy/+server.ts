import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { allowLongRequest } from "$lib/server/long-request";
import { DeploymentService } from "$lib/services/deploy.service";

export const POST = async ({ params, locals, platform }) => {
	allowLongRequest(platform);
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const service = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!service) {
		return json({ error: "Not found" }, { status: 404 });
	}

	// Already orchestration-mode-agnostic : deployService() itself branches
	// on instanceSettings.orchestrationMode (standalone container vs. swarm
	// service), see deploy.service.ts.
	const result = await DeploymentService.deployService(service, locals.user.id);
	if (!result.success) {
		return json(
			{ deploymentId: result.deploymentId, error: result.error },
			{ status: 500 },
		);
	}
	return json(result);
};
