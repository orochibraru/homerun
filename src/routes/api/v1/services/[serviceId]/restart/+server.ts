import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { DockerService } from "#lib/services/docker.service.js";
import { ServiceLifecycleService } from "#lib/services/service-lifecycle.service.js";

const logger = new Logger("API");

export const POST = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const service = await ServiceDTO.get(params.serviceId);
	if (!service) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	if (service.swarmServiceId) {
		await DockerService.restartSwarmService(service.swarmServiceId);
		logger.info(
			`Swarm service restarted via API: service=${service.id} user=${locals.user.id}`,
		);
		return Response.json({ success: true });
	}

	if (!service.containerId) {
		return Response.json(
			{ error: "This service hasn't been deployed yet." },
			{ status: 400 },
		);
	}

	await ServiceLifecycleService.restart(service.containerId);
	logger.info(
		`Service restarted via API: service=${service.id} user=${locals.user.id}`,
	);
	return Response.json({ success: true });
};
