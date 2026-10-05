import { fail, redirect } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";
import { resolve } from "$app/paths";

function reason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export const load = async () => ({
	status: await ObjectStorageService.builtinStatus(),
	suggestedHost: config.baseDomain ? `s3.${config.baseDomain}` : "",
});

export const actions = {
	setEnabled: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const enabled = (await request.formData()).get("enabled") === "true";
		try {
			if (enabled) {
				await ObjectStorageService.enableBuiltin(locals.user.id);
			} else {
				await ObjectStorageService.disableBuiltin();
			}
			return { success: true };
		} catch (cause) {
			return fail(500, { error: reason(cause) });
		}
	},

	setPublicHost: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const host = String((await request.formData()).get("publicHost") ?? "");
		try {
			await ObjectStorageService.setBuiltinPublicHost(host);
			return { success: true };
		} catch (cause) {
			return fail(400, { error: reason(cause) });
		}
	},
};
