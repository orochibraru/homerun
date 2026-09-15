import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import { DeploymentService } from "$lib/services/deploy.service";
import { DockerService } from "$lib/services/docker.service";
import { ServiceLifecycleService } from "$lib/services/service-lifecycle.service";

const logger = new Logger("Services");

function lifecycleFailure(verb: string, error: unknown) {
	logger.error(`Failed to ${verb} service`, error);
	const reason = error instanceof Error ? error.message : "unknown error";
	return fail(500, {
		error: `Couldn't ${verb} the service : ${reason}. If its container was removed outside Homerun, resolve it from the Errors tab first.`,
	});
}

export const load = async ({ params, parent }) => {
	const { service: svc, user } = await parent();
	const [deployments, siblings] = await Promise.all([
		DeploymentDTO.listForService(params.serviceId),
		ServiceDTO.list(user.id),
	]);

	// A link between two services is an env var pointing at the other one's
	// internal DNS alias (its slug), which is exactly what the service-link
	// picker writes : deriving the graph from the env values means it stays
	// true for hand-written variables too, with no second source of truth to
	// keep in sync.
	const references = (
		from: { envVars: Record<string, string> | null },
		slug: string,
	) => Object.values(from.envVars ?? {}).some((value) => value.includes(slug));

	const others = siblings.filter((other) => other.id !== params.serviceId);
	const dependsOn = others
		.filter((other) => references(svc, other.slug))
		.map((other) => ({ id: other.id, name: other.name, slug: other.slug }));
	const usedBy = others
		.filter((other) => references(other, svc.slug))
		.map((other) => ({ id: other.id, name: other.name, slug: other.slug }));

	return {
		dependsOn,
		deployments: deployments.map((d) => d.toJSON()),
		usedBy,
	};
};

export const actions = {
	deploy: async ({ params, locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		// The client pre-generates this id so it can start polling the
		// progress endpoint immediately, before this request even resolves.
		const formData = await request.formData();
		const clientDeploymentId = formData.get("deploymentId") as string | null;

		const { deploymentId } = await DeploymentService.enqueueDeploy({
			clientDeploymentId,
			svc,
			userId: locals.user.id,
		});

		return { deploymentId, success: true };
	},

	restart: async ({ params, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		if (svc.swarmServiceId) {
			await DockerService.restartSwarmService(svc.swarmServiceId);
			logger.info(
				`Swarm service restarted: service=${svc.id} user=${locals.user.id}`,
			);
			return { success: true };
		}
		if (!svc.containerId) {
			return fail(400, { error: "This service hasn't been deployed yet." });
		}

		try {
			await ServiceLifecycleService.restart(svc.containerId);
		} catch (error) {
			return lifecycleFailure("restart", error);
		}
		logger.info(`Service restarted: service=${svc.id} user=${locals.user.id}`);
		return { success: true };
	},

	start: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		if (svc.swarmServiceId) {
			await DockerService.scaleSwarmService(
				svc.swarmServiceId,
				svc.replicas || 1,
			);
			await svc.update({ desiredState: "running" });
			logger.info(
				`Swarm service started: service=${svc.id} user=${locals.user.id}`,
			);
			NotificationDTO.notify({
				message: `"${svc.name}" was started.`,
				serviceId: svc.id,
				type: "service_started",
				userId: locals.user.id,
			});
			return { success: true };
		}
		if (!svc.containerId) {
			return fail(400, { error: "This service hasn't been deployed yet." });
		}

		try {
			await ServiceLifecycleService.start(svc.containerId);
		} catch (error) {
			return lifecycleFailure("start", error);
		}
		await svc.update({ desiredState: "running" });
		logger.info(`Service started: service=${svc.id} user=${locals.user.id}`);
		NotificationDTO.notify({
			message: `"${svc.name}" was started.`,
			serviceId: svc.id,
			type: "service_started",
			userId: locals.user.id,
		});
		return { success: true };
	},

	stop: async ({ params, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		if (svc.swarmServiceId) {
			await DockerService.scaleSwarmService(svc.swarmServiceId, 0);
			await svc.update({ desiredState: "stopped" });
			logger.info(
				`Swarm service stopped: service=${svc.id} user=${locals.user.id}`,
			);
			NotificationDTO.notify({
				message: `"${svc.name}" was stopped.`,
				serviceId: svc.id,
				type: "service_stopped",
				userId: locals.user.id,
			});
			return { success: true };
		}
		if (!svc.containerId) {
			return fail(400, { error: "This service hasn't been deployed yet." });
		}

		try {
			await ServiceLifecycleService.stop(svc.containerId);
		} catch (error) {
			return lifecycleFailure("stop", error);
		}
		await svc.update({ desiredState: "stopped" });
		logger.info(`Service stopped: service=${svc.id} user=${locals.user.id}`);
		NotificationDTO.notify({
			message: `"${svc.name}" was stopped.`,
			serviceId: svc.id,
			type: "service_stopped",
			userId: locals.user.id,
		});
		return { success: true };
	},
};
