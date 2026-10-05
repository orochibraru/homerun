import { redirect } from "@sveltejs/kit";
import { PASSWORD_METHOD } from "#lib/auth-providers.js";
import { config } from "#lib/config.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { OauthClientDTO } from "#lib/dto/oauth-client-dto.js";
import { authBranding } from "#lib/error-pages.js";
import { REDIRECT_TO_PARAM, safeRedirectTarget } from "#lib/redirect-target.js";
import { passkeyUsableOn } from "#lib/security-policy.js";
import { gatedAppFor } from "#lib/server/app-gate-return.js";
import {
	browserOrigin,
	offCanonicalOrigin,
} from "#lib/server/canonical-origin.js";
import { AdminService } from "#lib/services/admin.service.js";
import { PASSKEY_SIGN_IN } from "#lib/sign-in-methods.js";
import { resolve } from "$app/paths";

export const load = async ({ request, url, locals }) => {
	const hasUsers = await AdminService.hasAnyUser();
	if (!hasUsers) {
		throw redirect(302, resolve("auth/sign-up"));
	}
	const redirectTo = safeRedirectTarget(
		url.searchParams.get(REDIRECT_TO_PARAM),
	);
	const oauthClientId = url.searchParams.has("sig")
		? url.searchParams.get("client_id")
		: null;
	if (locals.user && !oauthClientId) {
		throw redirect(302, redirectTo ?? resolve(""));
	}
	const canonicalOrigin = offCanonicalOrigin(request, url);
	const gatedApp = oauthClientId ? null : await gatedAppFor(redirectTo);
	const appMethods = gatedApp?.methods ?? null;
	const passkeyAvailable =
		(!appMethods || appMethods.includes(PASSWORD_METHOD)) &&
		passkeyUsableOn(browserOrigin(request, url), config.auth.origin);
	const settings = await InstanceSettingsDTO.get();
	return {
		appMethods,
		appName: oauthClientId
			? ((await OauthClientDTO.getByClientId(oauthClientId))?.name ?? null)
			: (gatedApp?.name ?? null),
		branding: gatedApp ? authBranding(settings.errorPages) : null,
		email: url.searchParams.get("email"),
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
