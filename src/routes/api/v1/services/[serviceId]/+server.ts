import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { HOST_ACCESS_MESSAGE, hostAccessChanged } from "$lib/host-access";
import { Logger } from "$lib/logger";
import { invalidateGatedService } from "$lib/server/gated-service-cache";
import { allowLongRequest } from "$lib/server/long-request";
import { updateServiceApiBody } from "$lib/server/validation/api";
import { normalizeDomains } from "$lib/service-domains";
import { WorkloadDetachError } from "$lib/services/docker/workload-removal";
import { DockerService } from "$lib/services/docker.service";
import { GitWebhookService } from "$lib/services/git-webhook.service";
import { PreviewService } from "$lib/services/preview.service";
import { encryptSecret } from "$lib/services/secrets";
import { ServiceLifecycleService } from "$lib/services/service-lifecycle.service";

const logger = new Logger("API");

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
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
	if (svc.containerId || svc.swarmServiceId) {
		await DockerService.syncServiceStatus(svc.id);
		const fresh = await ServiceDTO.get(params.serviceId);
		return json((fresh ?? svc).toJSON());
	}
	return json(svc.toJSON());
};

export const PATCH = async ({ params, request, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
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
	if (rest.domains) {
		rest.domains = normalizeDomains(rest.domains);
		const taken = await ServiceDTO.domainTaken(rest.domains, svc.id);
		if (taken) {
			return json(
				{ error: `${taken} is already routed to another service.` },
				{ status: 409 },
			);
		}
	}
	if (!locals.isAdmin && hostAccessChanged(svc.toJSON(), rest)) {
		return json({ error: HOST_ACCESS_MESSAGE }, { status: 403 });
	}

	const previousWebhook = {
		gitProviderId: svc.gitProviderId,
		gitRepo: svc.gitRepo,
		gitWebhookId: svc.gitWebhookId,
		previewsEnabled: svc.toJSON().previewsEnabled,
	};
	await svc.update({
		...rest,
		...(registryPassword
			? { registryPasswordEnc: encryptSecret(registryPassword) }
			: {}),
	});
	await GitWebhookService.sync(svc, previousWebhook);
	if (previousWebhook.previewsEnabled && !svc.toJSON().previewsEnabled) {
		await PreviewService.removeAll(svc);
	}
	invalidateGatedService(svc.id);

	logger.info(
		`Service updated via API: service=${svc.id} user=${locals.user.id}`,
	);
	return json(svc.toJSON());
};

export const DELETE = async ({ params, locals, platform, url }) => {
	allowLongRequest(platform);
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}

	const force = url.searchParams.get("force") === "true";
	try {
		await ServiceLifecycleService.deleteService(svc, { force });
	} catch (error) {
		if (error instanceof WorkloadDetachError) {
			return json({ error: error.message }, { status: 409 });
		}
		throw error;
	}
	logger.info(
		`Service deleted via API: service=${svc.id} force=${force} user=${locals.user.id}`,
	);
	return new Response(null, { status: 204 });
};
