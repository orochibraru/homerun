import { OIDC_SCOPES } from "$lib/oidc-provider";
import { auth } from "./auth.ts";

/**
 * The readable reason behind a failed better-auth call. Its `APIError`s carry
 * an empty `message` and put the detail in the body, as an OAuth
 * `error_description` or a plain `message`.
 */
export function authErrorMessage(err: unknown, fallback: string): string {
	const body = (err as { body?: Record<string, unknown> } | null)?.body;
	const detail = body?.error_description ?? body?.message ?? body?.error;
	if (typeof detail === "string" && detail) {
		return detail;
	}
	return err instanceof Error && err.message ? err.message : fallback;
}

export interface OauthAppInput {
	confidential: boolean;
	enableEndSession: boolean;
	name: string;
	redirectUris: string[];
	requirePkce: boolean;
	skipConsent: boolean;
}

export interface CreatedOauthApp {
	clientId: string;
	clientSecret: string | null;
}

/**
 * Registers and edits the apps allowed to use "Sign in with Homerun",
 * through better-auth's own OAuth provider endpoints so client secrets are
 * generated and hashed the way the token endpoint expects. Reads go through
 * `OauthClientDTO` instead.
 */
class OauthAppServiceClass {
	/**
	 * Registers an app. A confidential app gets a client secret, returned here
	 * once and never readable again; a public one (a SPA or mobile app) gets
	 * none and must use PKCE. Runs as the signed-in admin whose request
	 * `headers` are passed: better-auth checks that session against
	 * `clientPrivileges` even for its server-only admin endpoint.
	 *
	 * @throws When better-auth rejects the input, for example a redirect URI
	 * that isn't a valid URL, or when the OIDC provider isn't enabled because
	 * the Dashboard URL isn't set.
	 */
	async create(
		input: OauthAppInput,
		headers: Headers,
	): Promise<CreatedOauthApp> {
		const created = await auth.api.adminCreateOAuthClient({
			headers,
			body: {
				client_name: input.name,
				enable_end_session: input.enableEndSession,
				grant_types: ["authorization_code", "refresh_token"],
				redirect_uris: input.redirectUris,
				require_pkce: input.confidential ? input.requirePkce : true,
				response_types: ["code"],
				scope: OIDC_SCOPES.join(" "),
				skip_consent: input.skipConsent,
				token_endpoint_auth_method: input.confidential
					? "client_secret_basic"
					: "none",
			},
		});
		return {
			clientId: created.client_id,
			clientSecret: created.client_secret ?? null,
		};
	}

	/**
	 * Saves an app's name, redirect URIs and consent/logout options. Whether
	 * it's confidential and its PKCE requirement are fixed at creation. Runs
	 * as the admin whose request `headers` are passed.
	 *
	 * @throws When better-auth rejects the update.
	 */
	async update(
		clientId: string,
		input: Pick<
			OauthAppInput,
			"enableEndSession" | "name" | "redirectUris" | "skipConsent"
		>,
		headers: Headers,
	): Promise<void> {
		await auth.api.adminUpdateOAuthClient({
			headers,
			body: {
				client_id: clientId,
				update: {
					client_name: input.name,
					enable_end_session: input.enableEndSession,
					redirect_uris: input.redirectUris,
					skip_consent: input.skipConsent,
				},
			},
		});
	}

	/**
	 * Issues a new client secret, invalidating the old one immediately. Runs
	 * as the signed-in admin whose request `headers` are passed.
	 *
	 * @returns The new secret, shown once.
	 * @throws When the app is public (it has no secret) or the caller isn't
	 * allowed to manage clients.
	 */
	async rotateSecret(clientId: string, headers: Headers): Promise<string> {
		const rotated = await auth.api.rotateClientSecret({
			body: { client_id: clientId },
			headers,
		});
		if (!rotated.client_secret) {
			throw new Error("This app is public, so it has no secret to rotate.");
		}
		return rotated.client_secret;
	}
}

export const OauthAppService = new OauthAppServiceClass();
