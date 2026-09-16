import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { oauthMethod } from "$lib/auth-providers";
import { config } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { passkeyUsableOn } from "$lib/security-policy";
import {
	browserOrigin,
	offCanonicalOrigin,
} from "$lib/server/canonical-origin";
import { AdminService } from "$lib/services/admin.service";
import {
	PASSKEY_SIGN_IN,
	PASSWORD_SIGN_IN,
	splitSignInMethods,
} from "$lib/sign-in-methods";

export const load = async ({ request, url, locals }) => {
	const hasUsers = await AdminService.hasAnyUser();
	if (!hasUsers) {
		throw redirect(302, resolve("/auth/sign-up"));
	}
	if (locals.user) {
		throw redirect(302, resolve("/"));
	}
	const canonicalOrigin = offCanonicalOrigin(request, url);
	const passkeyAvailable = passkeyUsableOn(
		browserOrigin(request, url),
		config.auth.origin,
	);
	const oauthProviders = config.auth.oauthProviders
		.filter((p) => p.enabled)
		.map((p) => ({
			label: p.label || p.name,
			method: oauthMethod(p.name),
			name: p.name,
		}));
	const settings = await InstanceSettingsDTO.get();
	const methods = splitSignInMethods(
		[
			PASSWORD_SIGN_IN,
			...(passkeyAvailable ? [PASSKEY_SIGN_IN] : []),
			...oauthProviders.map((p) => p.method),
		],
		settings.preferredSignInMethods,
	);
	return {
		canonicalSignInUrl: canonicalOrigin
			? `${canonicalOrigin}${url.pathname}`
			: null,
		oauthProviders,
		otherMethods: methods.others,
		passkeyAvailable,
		primaryMethods: methods.primary,
		promptPasskeyOnLoad:
			passkeyAvailable &&
			settings.preferredSignInMethods.includes(PASSKEY_SIGN_IN),
	};
};
