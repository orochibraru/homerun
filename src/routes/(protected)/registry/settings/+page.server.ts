import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { RegistryService } from "$lib/services/registry.service";

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export const load = async () => ({
	suggestedHost: config.baseDomain ? `registry.${config.baseDomain}` : "",
});

export const actions = {
	setAuth: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const enabled = (await request.formData()).get("enabled") === "true";
		try {
			await RegistryService.setAuthEnabled(enabled);
			return { success: true };
		} catch (error) {
			return fail(400, { error: reason(error) });
		}
	},

	setPublicHost: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const host = String((await request.formData()).get("publicHost") ?? "");
		try {
			await RegistryService.setPublicHost(host);
			return { success: true };
		} catch (error) {
			return fail(400, { error: reason(error) });
		}
	},
};
