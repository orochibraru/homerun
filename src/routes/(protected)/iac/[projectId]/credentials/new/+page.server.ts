import { redirect } from "@sveltejs/kit";
import { createIacApiKeyAction } from "#lib/server/iac-api-key.js";
import { resolve } from "$app/paths";

export const actions = {
	createApiKey: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		return await createIacApiKeyAction(
			locals.user.id,
			locals.permissions,
			await request.formData(),
		);
	},
};
