import { parseRedirectUris } from "$lib/oidc-provider";
import { checkbox } from "$lib/server/validation/instance-settings-form";
import type { OauthAppInput } from "$lib/services/oauth-app.service";

export interface ParsedOauthApp {
	error: string | null;
	input: OauthAppInput | null;
}

/**
 * Reads and validates the "Sign in with Homerun" app form: a name, at least
 * one https redirect URI, and the consent, logout, client type and
 * PKCE options.
 */
export function parseOauthAppForm(formData: FormData): ParsedOauthApp {
	const name = String(formData.get("name") ?? "").trim();
	if (!name) {
		return { error: "Give the app a name.", input: null };
	}
	const redirectUris = parseRedirectUris(
		String(formData.get("redirectUris") ?? ""),
	);
	if (redirectUris.length === 0) {
		return {
			error: "Add at least one redirect URI, from the app's own OIDC settings.",
			input: null,
		};
	}
	const invalid = redirectUris.find((uri) => {
		try {
			return new URL(uri).protocol !== "https:";
		} catch {
			return true;
		}
	});
	if (invalid) {
		return {
			error: `"${invalid}" isn't an https URL. Redirect URIs have to use https, which every app Homerun routes already has.`,
			input: null,
		};
	}
	return {
		error: null,
		input: {
			confidential: formData.get("clientType") !== "public",
			enableEndSession: checkbox(formData, "enableEndSession"),
			name,
			redirectUris,
			requirePkce: checkbox(formData, "requirePkce"),
			skipConsent: checkbox(formData, "skipConsent"),
		},
	};
}
