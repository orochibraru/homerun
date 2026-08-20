import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { openTerminalSession } from "$lib/server/docker/terminal";

const logger = new Logger("Terminal");

export const POST = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	if (!svc.containerId || svc.currentStatus !== "running") {
		return json({ error: "This service isn't running." }, { status: 400 });
	}

	const sessionId = await openTerminalSession({
		containerId: svc.containerId,
		serviceId: svc.id,
		userId: locals.user.id,
	});

	logger.info(
		`Terminal session opened: service=${svc.id} container=${svc.containerId} session=${sessionId} user=${locals.user.id}`,
	);

	return json({ sessionId });
};
