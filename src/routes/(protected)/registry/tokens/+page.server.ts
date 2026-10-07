import { fail, redirect } from "@sveltejs/kit";
import { RegistryService } from "#lib/services/registry.service.js";
import { resolve } from "$app/paths";

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
			throw redirect(302, resolve("auth/sign-in"));
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
			throw redirect(302, resolve("auth/sign-in"));
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
