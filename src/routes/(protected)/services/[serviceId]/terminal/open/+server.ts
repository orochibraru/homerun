import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { DockerService } from "$lib/services/docker.service";

const logger = new Logger("Terminal");

export const POST = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	if (svc.currentStatus !== "running") {
		return json({ error: "This service isn't running." }, { status: 400 });
	}

	// Swarm mode : `docker exec` is always container-level, there's no
	// service-level exec, so resolve the live task's actual container id
	// first (see docker/swarm.ts). Standalone mode already has the
	// container id directly on the row.
	const containerId = svc.swarmServiceId
		? await DockerService.getRunningTaskContainerId(svc.swarmServiceId)
		: svc.containerId;
	if (!containerId) {
		return json(
			{ error: "No running container found for this service." },
			{ status: 400 },
		);
	}

	const sessionId = await DockerService.openTerminalSession({
		containerId,
		serviceId: svc.id,
		userId: locals.user.id,
	});

	logger.info(
		`Terminal session opened: service=${svc.id} container=${containerId} session=${sessionId} user=${locals.user.id}`,
	);

	return json({ sessionId });
};
