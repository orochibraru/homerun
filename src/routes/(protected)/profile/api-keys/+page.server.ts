import { redirect } from "@sveltejs/kit";
import { listOwnApiKeys, revokeApiKeyAction } from "#lib/server/api-keys.js";
import { resolve } from "$app/paths";

export const load = async ({ request }) => ({
	apiKeys: await listOwnApiKeys(request.headers),
});

export const actions = {
	revoke: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		return await revokeApiKeyAction(request, locals.user.id);
	},
};
