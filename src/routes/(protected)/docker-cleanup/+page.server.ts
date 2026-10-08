import { redirect } from "@sveltejs/kit";
import { queueCleanup } from "#lib/services/docker-cleanup-queue.js";
import { resolve } from "$app/paths";

export const actions = {
	pruneBuildCache: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		return await queueCleanup("pruneBuildCache", false, locals.user.id);
	},

	pruneContainers: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		return await queueCleanup("pruneContainers", false, locals.user.id);
	},

	pruneImages: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const formData = await request.formData();
		return await queueCleanup(
			"pruneImages",
			formData.get("all") === "on",
			locals.user.id,
		);
	},

	pruneMirror: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		return await queueCleanup("pruneMirror", false, locals.user.id);
	},

	reclaimStackNetworks: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		return await queueCleanup("reclaimStackNetworks", false, locals.user.id);
	},

	pruneNetworks: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		return await queueCleanup("pruneNetworks", false, locals.user.id);
	},

	pruneSystem: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		return await queueCleanup("pruneSystem", false, locals.user.id);
	},

	pruneVolumes: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		return await queueCleanup("pruneVolumes", false, locals.user.id);
	},
};
