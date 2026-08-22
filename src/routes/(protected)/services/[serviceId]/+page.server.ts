import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { DeploymentService } from "$lib/services/deploy.service";
import { DockerService } from "$lib/services/docker.service";

const logger = new Logger("Services");

export const load = async ({ params }) => {
	const deployments = await DeploymentDTO.listForService(params.serviceId);

	return { deployments: deployments.map((d) => d.toJSON()) };
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

		const result = await DeploymentService.deployService(
			svc,
			locals.user.id,
			clientDeploymentId,
		);
		if (!result.success) {
			return fail(500, {
				deploymentId: result.deploymentId,
				error:
					"Deploy failed : check the deployment history below for details.",
			});
		}

		return { deploymentId: result.deploymentId, success: true };
	},

	restart: async ({ params, locals }) => {
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

		const remote = await RemoteHostDTO.connectionFor(svc, locals.user.id);
		await DockerService.restartContainer(svc.containerId, remote);
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

		const remote = await RemoteHostDTO.connectionFor(svc, locals.user.id);
		await DockerService.startContainer(svc.containerId, remote);
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

	stop: async ({ params, locals }) => {
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

		const remote = await RemoteHostDTO.connectionFor(svc, locals.user.id);
		await DockerService.stopContainer(svc.containerId, remote);
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
