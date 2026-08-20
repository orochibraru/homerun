import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { Logger } from "$lib/logger";
import { DockerService } from "$lib/services/docker.service";

const logger = new Logger("Traefik");

export const load = async () => {
	const traefik = await DockerService.findTraefikContainer();
	return { traefik };
};

export const actions = {
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
