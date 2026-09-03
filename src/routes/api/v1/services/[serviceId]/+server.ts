import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import { updateServiceApiBody } from "$lib/server/validation/api";
import { DockerService } from "$lib/services/docker.service";
import { encryptSecret } from "$lib/services/secrets";
import { ServiceLifecycleService } from "$lib/services/service-lifecycle.service";

const logger = new Logger("API");

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	// Real, tested-in-review finding, from this app's own integration test
	// suite (tests/integration/) : unlike the dashboard's own
	// [serviceId]/+layout.server.ts, which reconciles `currentStatus`
	// against live Docker/agent state on every page load, this route used to
	// just return the raw DB row. start/stop/restart (below, and the sibling
	// action routes) only ever update `desiredState`, never `currentStatus`
	// directly, so an API consumer polling this endpoint after a stop/start
	// would see a stale `currentStatus` forever, never reflecting reality
	// unless someone happened to also load the dashboard page for that
	// service. Same fix, same call, as the dashboard's own reconciliation.
	if (svc.containerId) {
		await DockerService.syncServiceStatus(svc.id, locals.user.id);
		const fresh = await ServiceDTO.get(params.serviceId, locals.user.id);
		return json((fresh ?? svc).toJSON());
	}
	return json(svc.toJSON());
};

export const PATCH = async ({ params, request, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}

	const body = await request.json().catch(() => null);
	const result = updateServiceApiBody.safeParse(body);
	if (!result.success) {
		return json(
			{ error: "Invalid request body", issues: result.error.flatten() },
			{ status: 400 },
		);
	}
	const { registryPassword, ...rest } = result.data;

	await svc.update({
		...rest,
		...(registryPassword
			? { registryPasswordEnc: encryptSecret(registryPassword) }
			: {}),
	});

	logger.info(
		`Service updated via API: service=${svc.id} user=${locals.user.id}`,
	);
	return json(svc.toJSON());
};

export const DELETE = async ({ params, locals, platform }) => {
	allowLongRequest(platform);
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}

	if (svc.containerId) {
		try {
			await ServiceLifecycleService.remove(
				svc.containerId,
				svc.remoteHostId,
				locals.user.id,
			);
		} catch {
			// Already gone on the host : proceed with deleting the record.
		}
	}
	await svc.delete();
	logger.info(
		`Service deleted via API: service=${svc.id} user=${locals.user.id}`,
	);
	return new Response(null, { status: 204 });
};
