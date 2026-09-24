import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import { DeploymentService } from "$lib/services/deploy.service";
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
	const { service: svc } = await parent();
	const [deployments, siblings] = await Promise.all([
		DeploymentDTO.listForService(params.serviceId),
		ServiceDTO.list(),
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
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		// The client pre-generates this id so it can start polling the
		// progress endpoint immediately, before this request even resolves.
		const formData = await request.formData();
		const clientDeploymentId = formData.get("deploymentId") as string | null;

		const { deploymentId } = await DeploymentService.enqueueDeploy({
			clientDeploymentId,
			noCache: formData.get("noCache") === "1",
			svc,
			userId: locals.user.id,
		});

		return { deploymentId, success: true };
	},

	kill: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		try {
			await ServiceLifecycleService.killService(svc);
		} catch (error) {
			return lifecycleFailure("kill", error);
		}
		logger.info(`Service killed: service=${svc.id} user=${locals.user.id}`);
		NotificationDTO.notify({
			message: `"${svc.name}" was killed.`,
			serviceId: svc.id,
			type: "service_stopped",
		});
		return { success: true };
	},

	pull: async ({ params, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		try {
			const { changed } = await ServiceLifecycleService.pullServiceImage(svc);
			logger.info(
				`Image pulled: service=${svc.id} changed=${changed} user=${locals.user.id}`,
			);
			return {
				message: changed
					? `Pulled a newer ${svc.image}:${svc.tag}, redeploy to run it.`
					: `${svc.image}:${svc.tag} is already up to date.`,
				success: true,
			};
		} catch (error) {
			logger.error("Failed to pull service image", error);
			return fail(500, {
				error: `Couldn't pull ${svc.image}:${svc.tag} : ${error instanceof Error ? error.message : "unknown error"}.`,
			});
		}
	},

	restart: async ({ params, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		try {
			await ServiceLifecycleService.restartService(svc);
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
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		try {
			await ServiceLifecycleService.startService(svc);
		} catch (error) {
			return lifecycleFailure("start", error);
		}
		logger.info(`Service started: service=${svc.id} user=${locals.user.id}`);
		NotificationDTO.notify({
			message: `"${svc.name}" was started.`,
			serviceId: svc.id,
			type: "service_started",
		});
		return { success: true };
	},

	stop: async ({ params, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		try {
			await ServiceLifecycleService.stopService(svc);
		} catch (error) {
			return lifecycleFailure("stop", error);
		}
		logger.info(`Service stopped: service=${svc.id} user=${locals.user.id}`);
		NotificationDTO.notify({
			message: `"${svc.name}" was stopped.`,
			serviceId: svc.id,
			type: "service_stopped",
		});
		return { success: true };
	},
};
