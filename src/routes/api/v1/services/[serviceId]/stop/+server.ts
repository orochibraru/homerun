import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import { DockerService } from "$lib/services/docker.service";
import { ServiceLifecycleService } from "$lib/services/service-lifecycle.service";

const logger = new Logger("API");

export const POST = async ({ params, locals, platform }) => {
	allowLongRequest(platform);
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const service = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!service) {
		return json({ error: "Not found" }, { status: 404 });
	}

	if (service.swarmServiceId) {
		await DockerService.scaleSwarmService(service.swarmServiceId, 0);
		await service.update({ desiredState: "stopped" });
		logger.info(
			`Swarm service stopped via API: service=${service.id} user=${locals.user.id}`,
		);
		return json({ success: true });
	}

	if (!service.containerId) {
		return json(
			{ error: "This service hasn't been deployed yet." },
			{ status: 400 },
		);
	}

	await ServiceLifecycleService.stop(
		service.containerId,
		service.remoteHostId,
		locals.user.id,
	);
	await service.update({ desiredState: "stopped" });
	logger.info(
		`Service stopped via API: service=${service.id} user=${locals.user.id}`,
	);
	return json({ success: true });
};
