import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { DockerService } from "$lib/services/docker.service";
import { ServiceLifecycleService } from "$lib/services/service-lifecycle.service";

const logger = new Logger("API");

export const POST = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const service = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!service) {
		return json({ error: "Not found" }, { status: 404 });
	}

	if (service.swarmServiceId) {
		await DockerService.restartSwarmService(service.swarmServiceId);
		logger.info(
			`Swarm service restarted via API: service=${service.id} user=${locals.user.id}`,
		);
		return json({ success: true });
	}

	if (!service.containerId) {
		return json(
			{ error: "This service hasn't been deployed yet." },
			{ status: 400 },
		);
	}

	await ServiceLifecycleService.restart(
		service.containerId,
		service.remoteHostId,
		locals.user.id,
	);
	logger.info(
		`Service restarted via API: service=${service.id} user=${locals.user.id}`,
	);
	return json({ success: true });
};
