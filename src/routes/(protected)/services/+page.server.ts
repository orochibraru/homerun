import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import { DockerService } from "$lib/services/docker.service";
import { ServiceLifecycleService } from "$lib/services/service-lifecycle.service";

const logger = new Logger("Services");

async function loadServices(userId: string) {
	const rows = await ServiceDTO.listWithProjectNames(userId);

	await DockerService.syncAllServiceStatuses(
		rows
			.filter((r) => r.service.containerId || r.service.swarmServiceId)
			.map((r) => r.service.id),
		userId,
	);

	const fresh = rows.some(
		(r) => r.service.containerId || r.service.swarmServiceId,
	)
		? await ServiceDTO.listWithProjectNames(userId)
		: rows;

	return fresh.map((r) => ({
		...r.service.toJSON(),
		projectName: r.projectName,
	}));
}

export const load = async ({ parent }) => {
	const { user } = await parent();
	const services = await loadServices(user.id);

	return {
		baseDomain: config.baseDomain,
		services,
	};
};

export const actions = {
	delete: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const data = await request.formData();
		const serviceId = data.get("serviceId") as string | null;
		if (!serviceId) {
			return fail(400, { error: "Missing service id." });
		}

		const svc = await ServiceDTO.get(serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		if (svc.swarmServiceId) {
			try {
				await DockerService.removeSwarmService(svc.swarmServiceId);
			} catch {
				// Service may already be gone on the swarm : proceed regardless.
			}
		} else if (svc.containerId) {
			try {
				await ServiceLifecycleService.remove(
					svc.containerId,
					svc.remoteHostId,
					locals.user.id,
				);
			} catch {
				// Container may already be gone on the host : proceed with
				// deleting our record regardless.
			}
		}
		await svc.delete();
		logger.info(`Service deleted: service=${serviceId} user=${locals.user.id}`);
		return { success: true };
	},

	restart: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const data = await request.formData();
		const serviceId = data.get("serviceId") as string | null;
		if (!serviceId) {
			return fail(400, { error: "Missing service id." });
		}

		const svc = await ServiceDTO.get(serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		if (svc.swarmServiceId) {
			await DockerService.restartSwarmService(svc.swarmServiceId);
			logger.info(
				`Swarm service restarted: service=${serviceId} user=${locals.user.id}`,
			);
			return { success: true };
		}
		if (!svc.containerId) {
			return fail(400, { error: "This service hasn't been deployed yet." });
		}

		await ServiceLifecycleService.restart(
			svc.containerId,
			svc.remoteHostId,
			locals.user.id,
		);
		logger.info(
			`Service restarted: service=${serviceId} user=${locals.user.id}`,
		);
		return { success: true };
	},
	start: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const data = await request.formData();
		const serviceId = data.get("serviceId") as string | null;
		if (!serviceId) {
			return fail(400, { error: "Missing service id." });
		}

		const svc = await ServiceDTO.get(serviceId, locals.user.id);
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
				`Swarm service started: service=${serviceId} user=${locals.user.id}`,
			);
			return { success: true };
		}
		if (!svc.containerId) {
			return fail(400, { error: "This service hasn't been deployed yet." });
		}

		await ServiceLifecycleService.start(
			svc.containerId,
			svc.remoteHostId,
			locals.user.id,
		);
		await svc.update({ desiredState: "running" });
		logger.info(`Service started: service=${serviceId} user=${locals.user.id}`);
		return { success: true };
	},

	stop: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const data = await request.formData();
		const serviceId = data.get("serviceId") as string | null;
		if (!serviceId) {
			return fail(400, { error: "Missing service id." });
		}

		const svc = await ServiceDTO.get(serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		if (svc.swarmServiceId) {
			await DockerService.scaleSwarmService(svc.swarmServiceId, 0);
			await svc.update({ desiredState: "stopped" });
			logger.info(
				`Swarm service stopped: service=${serviceId} user=${locals.user.id}`,
			);
			return { success: true };
		}
		if (!svc.containerId) {
			return fail(400, { error: "This service hasn't been deployed yet." });
		}

		await ServiceLifecycleService.stop(
			svc.containerId,
			svc.remoteHostId,
			locals.user.id,
		);
		await svc.update({ desiredState: "stopped" });
		logger.info(`Service stopped: service=${serviceId} user=${locals.user.id}`);
		return { success: true };
	},
};
