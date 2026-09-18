import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { OauthClientDTO } from "$lib/dto/oauth-client-dto";
import { REDIRECT_TO_PARAM, safeRedirectTarget } from "$lib/redirect-target";
import { passkeyUsableOn } from "$lib/security-policy";
import { gatedAppNameFor } from "$lib/server/app-gate-return";
import {
	browserOrigin,
	offCanonicalOrigin,
} from "$lib/server/canonical-origin";
import { AdminService } from "$lib/services/admin.service";
import { PASSKEY_SIGN_IN } from "$lib/sign-in-methods";

export const load = async ({ request, url, locals }) => {
	const hasUsers = await AdminService.hasAnyUser();
	if (!hasUsers) {
		throw redirect(302, resolve("/auth/sign-up"));
	}
	const redirectTo = safeRedirectTarget(
		url.searchParams.get(REDIRECT_TO_PARAM),
	);
	const oauthClientId = url.searchParams.has("sig")
		? url.searchParams.get("client_id")
		: null;
	if (locals.user && !oauthClientId) {
		throw redirect(302, redirectTo ?? resolve("/"));
	}
	const canonicalOrigin = offCanonicalOrigin(request, url);
	const passkeyAvailable = passkeyUsableOn(
		browserOrigin(request, url),
		config.auth.origin,
	);
	const settings = await InstanceSettingsDTO.get();
	return {
		appName: oauthClientId
			? ((await OauthClientDTO.getByClientId(oauthClientId))?.name ?? null)
			: await gatedAppNameFor(redirectTo),
		canonicalSignInUrl: canonicalOrigin
			? `${canonicalOrigin}${url.pathname}${url.search}`
			: null,
		passkeyAvailable,
		promptPasskeyOnLoad:
			passkeyAvailable &&
			settings.preferredSignInMethods.includes(PASSKEY_SIGN_IN),
		oauthSignIn: oauthClientId !== null,
		redirectTo: oauthClientId ? null : redirectTo,
	};
};
