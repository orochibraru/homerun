import { json } from "@sveltejs/kit";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";

/**
 * Polled by the Overview tab while a deploy is in flight (including right
 * after a page reload mid-deploy : see the resume logic there) : returns
 * the growing progress log plus the deployment's current status, so the
 * client knows when to stop polling.
 */
export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}

	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return new Response("Not found", { status: 404 });
	}

	const dep = await DeploymentDTO.get(params.deploymentId);
	if (!dep || dep.toJSON().serviceId !== svc.id) {
		return new Response("Not found", { status: 404 });
	}

	return json(
		{ log: dep.log, status: dep.toJSON().status },
		{ headers: { "Cache-Control": "no-store" } },
	);
};
