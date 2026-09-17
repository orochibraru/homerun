import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { RegistryService } from "$lib/services/registry.service";

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export const load = async ({ parent }) => {
	const { status } = await parent();
	const tokens = await RegistryService.listTokens();
	return {
		loginEndpoint: status.publicHost ?? status.internalEndpoint,
		tokens: tokens.map((token) => token.toJSON()),
	};
};

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const username = String((await request.formData()).get("username") ?? "")
			.trim()
			.toLowerCase();
		try {
			const created = await RegistryService.createToken(
				username,
				locals.user.id,
			);
			return { created, success: true };
		} catch (error) {
			return fail(400, { error: reason(error) });
		}
	},

	revoke: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const id = String((await request.formData()).get("id") ?? "");
		try {
			await RegistryService.revokeToken(id);
			return { success: true };
		} catch (error) {
			return fail(400, { error: reason(error) });
		}
	},
};
