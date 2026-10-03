import { redirect } from "@sveltejs/kit";
import { runQueuedCleanup } from "#lib/services/docker-cleanup-queue.js";
import { resolve } from "$app/paths";

export const load = ({ locals }) => {
	if (!locals.isAdmin) {
		throw redirect(302, resolve(""));
	}
};

export const actions = {
	pruneBuildCache: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		return await runQueuedCleanup("pruneBuildCache", false, locals.user.id);
	},

	pruneContainers: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		return await runQueuedCleanup("pruneContainers", false, locals.user.id);
	},

	pruneImages: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const formData = await request.formData();
		return await runQueuedCleanup(
			"pruneImages",
			formData.get("all") === "on",
			locals.user.id,
		);
	},

	pruneMirror: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		return await runQueuedCleanup("pruneMirror", false, locals.user.id);
	},

	reclaimStackNetworks: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		return await runQueuedCleanup(
			"reclaimStackNetworks",
			false,
			locals.user.id,
		);
	},

	pruneNetworks: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		return await runQueuedCleanup("pruneNetworks", false, locals.user.id);
	},

	pruneSystem: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		return await runQueuedCleanup("pruneSystem", false, locals.user.id);
	},

	pruneVolumes: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		return await runQueuedCleanup("pruneVolumes", false, locals.user.id);
	},
};
