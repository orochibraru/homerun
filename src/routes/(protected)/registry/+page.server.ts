import { fail, redirect } from "@sveltejs/kit";
import { parseListQuery } from "#lib/server/list-query.js";
import { runQueuedCleanup } from "#lib/services/docker-cleanup-queue.js";
import { ImageMirrorGcService } from "#lib/services/image-mirror-gc.service.js";
import { RegistryService } from "#lib/services/registry.service.js";
import { resolve } from "$app/paths";

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export const load = async ({ parent, url }) => {
	const { preferences } = await parent();
	const query = parseListQuery(url, {}, preferences.perPage);
	const listing = RegistryService.catalogPage(query)
		.then((result) => ({ ...result, unreachable: null }))
		.catch((error: unknown) => ({
			items: [],
			page: query.page,
			perPage: query.perPage,
			total: 0,
			unreachable: reason(error),
		}));
	return { listing, searched: query.q !== "" };
};

export const actions = {
	collectGarbage: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const busy = await ImageMirrorGcService.busyReason();
		if (busy) {
			return fail(409, { error: busy });
		}
		return await runQueuedCleanup("pruneMirror", false, locals.user.id);
	},
};
