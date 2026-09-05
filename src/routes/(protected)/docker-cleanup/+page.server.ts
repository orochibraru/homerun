import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { allowLongRequest } from "$lib/server/long-request";
import { DockerService } from "$lib/services/docker.service";
import { runQueuedCleanup } from "$lib/services/docker-cleanup-queue";

export const load = async ({ locals }) => {
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}

	const preview = await DockerService.getCleanupPreview();
	return { preview };
};

export const actions = {
	pruneBuildCache: async ({ locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		return await runQueuedCleanup("pruneBuildCache", false, locals.user.id);
	},

	pruneContainers: async ({ locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		return await runQueuedCleanup("pruneContainers", false, locals.user.id);
	},

	pruneImages: async ({ locals, platform, request }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		return await runQueuedCleanup(
			"pruneImages",
			formData.get("all") === "on",
			locals.user.id,
		);
	},

	pruneNetworks: async ({ locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		return await runQueuedCleanup("pruneNetworks", false, locals.user.id);
	},

	pruneSystem: async ({ locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		return await runQueuedCleanup("pruneSystem", false, locals.user.id);
	},

	pruneVolumes: async ({ locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		return await runQueuedCleanup("pruneVolumes", false, locals.user.id);
	},
};
