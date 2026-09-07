import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { offCanonicalOrigin } from "$lib/server/canonical-origin";
import { AdminService } from "$lib/services/admin.service";

export const load = async ({ request, url }) => {
	const hasUsers = await AdminService.hasAnyUser();
	if (!hasUsers) {
		throw redirect(302, resolve("/auth/sign-up"));
	}
	const canonicalOrigin = offCanonicalOrigin(request, url);
	return {
		canonicalSignInUrl: canonicalOrigin
			? `${canonicalOrigin}${url.pathname}`
			: null,
		oauthProviders: config.auth.oauthProviders
			.filter((p) => p.enabled)
			.map((p) => ({ label: p.label || p.name, name: p.name })),
	};
};
