import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { Logger } from "$lib/logger";
import { ImageMirrorGcService } from "$lib/services/image-mirror-gc.service";
import { RegistryService } from "$lib/services/registry.service";

const logger = new Logger("Registry");

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export const load = async () => {
	try {
		return { catalog: await RegistryService.catalog(), unreachable: null };
	} catch (error) {
		return { catalog: [], unreachable: reason(error) };
	}
};

export const actions = {
	collectGarbage: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const busy = await ImageMirrorGcService.busyReason();
		if (busy) {
			return fail(409, { error: busy });
		}
		try {
			const result = await ImageMirrorGcService.collect();
			return { reclaimedBytes: result.spaceReclaimedBytes, success: true };
		} catch (error) {
			logger.warn(`Registry garbage collection failed: ${reason(error)}`);
			return fail(500, { error: reason(error) });
		}
	},

	deleteRepository: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const repository = String(
			(await request.formData()).get("repository") ?? "",
		);
		if (!repository) {
			return fail(400, { error: "Which repository?" });
		}
		try {
			const deleted = await RegistryService.deleteRepository(repository);
			return { deleted, success: true };
		} catch (error) {
			return fail(500, { error: reason(error) });
		}
	},

	deleteTag: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const repository = String(formData.get("repository") ?? "");
		const tag = String(formData.get("tag") ?? "");
		if (!(repository && tag)) {
			return fail(400, { error: "Which tag?" });
		}
		try {
			const deleted = await RegistryService.deleteTag(repository, tag);
			return deleted
				? { success: true }
				: fail(404, { error: `${repository}:${tag} was already gone.` });
		} catch (error) {
			return fail(500, { error: reason(error) });
		}
	},
};
