import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { Logger } from "$lib/logger";
import { DockerService } from "$lib/services/docker.service";

const logger = new Logger("DockerCleanup");

export const load = async ({ locals }) => {
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}

	const preview = await DockerService.getCleanupPreview();
	return { preview };
};

export const actions = {
	pruneBuildCache: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		try {
			const result = await DockerService.pruneBuildCache();
			logger.info(`Build cache pruned by user=${locals.user.id}`);
			return { action: "pruneBuildCache", result, success: true };
		} catch (err) {
			logger.error("Failed to prune build cache", err);
			return fail(500, {
				action: "pruneBuildCache",
				error:
					err instanceof Error ? err.message : "Failed to prune build cache.",
			});
		}
	},

	pruneContainers: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		try {
			const result = await DockerService.pruneContainers();
			logger.info(`Stopped containers pruned by user=${locals.user.id}`);
			return { action: "pruneContainers", result, success: true };
		} catch (err) {
			logger.error("Failed to prune containers", err);
			return fail(500, {
				action: "pruneContainers",
				error:
					err instanceof Error ? err.message : "Failed to prune containers.",
			});
		}
	},

	pruneImages: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		const formData = await request.formData();
		const all = formData.get("all") === "on";

		try {
			const result = await DockerService.pruneImages(all);
			logger.info(`Images pruned (all=${all}) by user=${locals.user.id}`);
			return { action: "pruneImages", result, success: true };
		} catch (err) {
			logger.error("Failed to prune images", err);
			return fail(500, {
				action: "pruneImages",
				error: err instanceof Error ? err.message : "Failed to prune images.",
			});
		}
	},

	pruneNetworks: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		try {
			const result = await DockerService.pruneNetworks();
			logger.info(`Unused networks pruned by user=${locals.user.id}`);
			return { action: "pruneNetworks", result, success: true };
		} catch (err) {
			logger.error("Failed to prune networks", err);
			return fail(500, {
				action: "pruneNetworks",
				error: err instanceof Error ? err.message : "Failed to prune networks.",
			});
		}
	},

	pruneSystem: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		try {
			const result = await DockerService.pruneSystem();
			logger.info(`System prune run by user=${locals.user.id}`);
			return { action: "pruneSystem", result, success: true };
		} catch (err) {
			logger.error("Failed to run system prune", err);
			return fail(500, {
				action: "pruneSystem",
				error:
					err instanceof Error ? err.message : "Failed to run system prune.",
			});
		}
	},

	pruneVolumes: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		try {
			const result = await DockerService.pruneVolumes();
			logger.info(`Unused volumes pruned by user=${locals.user.id}`);
			return { action: "pruneVolumes", result, success: true };
		} catch (err) {
			logger.error("Failed to prune volumes", err);
			return fail(500, {
				action: "pruneVolumes",
				error: err instanceof Error ? err.message : "Failed to prune volumes.",
			});
		}
	},
};
