import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { allowLongRequest } from "$lib/server/long-request";
import { DeploymentService } from "$lib/services/deploy.service";
import { QueueService } from "$lib/services/queue.service";

export const POST = async ({ params, locals, platform }) => {
	allowLongRequest(platform);
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const service = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!service) {
		return json({ error: "Not found" }, { status: 404 });
	}

	const { deploymentId, jobId } = await DeploymentService.enqueueDeploy({
		svc: service,
		userId: locals.user.id,
	});
	const finished = await QueueService.wait(jobId);
	if (finished.status !== "succeeded") {
		return json(
			{ deploymentId, error: finished.error ?? "Deploy failed." },
			{ status: 500 },
		);
	}
	return json({
		containerId: (finished.result?.containerId as string | null) ?? undefined,
		deploymentId,
		success: true,
	});
};
