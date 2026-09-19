import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { AppLogDTO } from "$lib/dto/app-log-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { DockerService } from "$lib/services/docker.service";

const logger = new Logger("Traefik");

export const load = async ({ locals }) => {
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}

	const [logs, services] = await Promise.all([
		AppLogDTO.listRecent(200),
		ServiceDTO.list(),
	]);
	const serviceNames = new Map(services.map((svc) => [svc.id, svc.name]));

	return {
		appLogs: logs.map((log) => {
			const row = log.toJSON();
			return {
				...row,
				serviceName: row.serviceId
					? (serviceNames.get(row.serviceId) ?? null)
					: null,
			};
		}),
	};
};

export const actions = {
	clearAppLogs: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		await AppLogDTO.clear();
		logger.info(`Application log cleared by user=${locals.user.id}`);
		return { action: "clearAppLogs", success: true };
	},

	restartTraefik: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		try {
			await DockerService.restartTraefikContainer();
			logger.info(`Traefik restarted by user=${locals.user.id}`);
			return { action: "restartTraefik", success: true };
		} catch (err) {
			logger.error("Failed to restart Traefik", err);
			return fail(500, {
				action: "restartTraefik",
				error:
					err instanceof Error ? err.message : "Failed to restart Traefik.",
			});
		}
	},

	updateTraefik: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		try {
			const result = await DockerService.updateTraefikContainer();
			logger.info(
				`Traefik update by user=${locals.user.id}: ${result.message}`,
			);
			return {
				action: "updateTraefik",
				message: result.message,
				success: true,
				updated: result.updated,
			};
		} catch (err) {
			logger.error("Failed to update Traefik", err);
			return fail(500, {
				action: "updateTraefik",
				error: err instanceof Error ? err.message : "Failed to update Traefik.",
			});
		}
	},
};
