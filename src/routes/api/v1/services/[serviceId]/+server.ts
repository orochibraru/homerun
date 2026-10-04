import { ServiceDTO } from "#lib/dto/service-dto.js";
import { HOST_ACCESS_MESSAGE, hostAccessChanged } from "#lib/host-access.js";
import { Logger } from "#lib/logger.js";
import { normalizeEnvironmentName } from "#lib/release-channels.js";
import { invalidateGatedService } from "#lib/server/gated-service-cache.js";
import { updateServiceApiBody } from "#lib/server/validation/api.js";
import { normalizeDomains } from "#lib/service-domains.js";
import { DeploymentService } from "#lib/services/deploy.service.js";
import { WorkloadDetachError } from "#lib/services/docker/workload-removal.js";
import { DockerService } from "#lib/services/docker.service.js";
import { GitWebhookService } from "#lib/services/git-webhook.service.js";
import { PreviewService } from "#lib/services/preview.service.js";
import { encryptSecret } from "#lib/services/secrets.js";
import { ServiceLifecycleService } from "#lib/services/service-lifecycle.service.js";

const logger = new Logger("API");

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
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
		return Response.json((fresh ?? svc).toJSON());
	}
	return Response.json(svc.toJSON());
};

export const PATCH = async ({ params, request, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	const body = await request.json().catch(() => null);
	const result = updateServiceApiBody.safeParse(body);
	if (!result.success) {
		return Response.json(
			{ error: "Invalid request body", issues: result.error.flatten() },
			{ status: 400 },
		);
	}
	const { registryPassword, ...rest } = result.data;
	if (rest.environmentName !== undefined) {
		rest.environmentName = normalizeEnvironmentName(rest.environmentName);
	}
	if (rest.domains) {
		rest.domains = normalizeDomains(rest.domains);
		const taken = await ServiceDTO.domainTaken(rest.domains, svc.id);
		if (taken) {
			return Response.json(
				{ error: `${taken} is already routed to another service.` },
				{ status: 409 },
			);
		}
	}
	if (!locals.isAdmin && hostAccessChanged(svc.toJSON(), rest)) {
		return Response.json({ error: HOST_ACCESS_MESSAGE }, { status: 403 });
	}

	const previousWebhook = {
		gitProviderId: svc.gitProviderId,
		gitRepo: svc.gitRepo,
		gitWebhookId: svc.gitWebhookId,
		previewsEnabled: svc.toJSON().previewsEnabled,
	};
	const wasRequired = svc.authRequired;
	await svc.update({
		...rest,
		...(registryPassword
			? { registryPasswordEnc: encryptSecret(registryPassword) }
			: {}),
	});
	await GitWebhookService.sync(svc, previousWebhook);
	if (previousWebhook.previewsEnabled && !svc.toJSON().previewsEnabled) {
		await PreviewService.removeAll(svc);
	} else if (rest.previewBranchInclude || rest.previewBranchExclude) {
		await PreviewService.applyBranchFilter(svc);
	}
	invalidateGatedService(svc.id);
	await DeploymentService.redeployIfLoginWallChanged(
		svc,
		wasRequired,
		locals.user.id,
	);

	logger.info(
		`Service updated via API: service=${svc.id} user=${locals.user.id}`,
	);
	return Response.json(svc.toJSON());
};

export const DELETE = async ({ params, locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	const force = url.searchParams.get("force") === "true";
	const deleteVolumes = url.searchParams.get("deleteVolumes") === "true";
	try {
		await ServiceLifecycleService.deleteService(svc, { deleteVolumes, force });
	} catch (error) {
		if (error instanceof WorkloadDetachError) {
			return Response.json({ error: error.message }, { status: 409 });
		}
		throw error;
	}
	logger.info(
		`Service deleted via API: service=${svc.id} force=${force} user=${locals.user.id}`,
	);
	return new Response(null, { status: 204 });
};
