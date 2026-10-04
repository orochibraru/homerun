import { config } from "#lib/config.js";
import { OauthClientDTO } from "#lib/dto/oauth-client-dto.js";
import {
	type EnvironmentInput,
	OauthClientEnvironmentDTO,
} from "#lib/dto/oauth-client-environment-dto.js";
import { OauthClientSecretDTO } from "#lib/dto/oauth-client-secret-dto.js";
import {
	CLAUDE_MCP_CALLBACK,
	OIDC_SCOPES,
	registeredCallbacks,
} from "#lib/oidc-provider.js";
import { hashClientSecret } from "#lib/server/client-secret.js";
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

export interface OauthAppSettings {
	enableEndSession: boolean;
	name: string;
	skipConsent: boolean;
}

export type SecretAuthMethod = "client_secret_basic" | "client_secret_post";

export interface OauthAppInput extends OauthAppSettings {
	confidential: boolean;
	environment: EnvironmentInput;
	requirePkce: boolean;
	tokenAuthMethod: SecretAuthMethod;
}

/**
 * How a new app authenticates at the token endpoint. better-auth accepts only
 * the method a client registered with; Claude's connector sends its secret
 * in the request body whatever was picked, so a client with Claude's callback
 * registers for that.
 */
function tokenAuthMethod(input: OauthAppInput): SecretAuthMethod | "none" {
	if (!input.confidential) {
		return "none";
	}
	return input.environment.redirectUris.includes(CLAUDE_MCP_CALLBACK)
		? "client_secret_post"
		: input.tokenAuthMethod;
}

export interface CreatedOauthApp {
	clientId: string;
	clientSecret: string | null;
}

/**
 * Registers and edits the apps allowed to use "Sign in with Homerun",
 * through better-auth's own OAuth provider endpoints for the client row,
 * while environments and secrets live in Homerun's own tables. Reads go
 * through the DTOs instead.
 */
class OauthAppServiceClass {
	/**
	 * Registers an app with its first environment. A confidential app gets a
	 * client secret in that environment, returned here once and never
	 * readable again; a public one (a SPA or mobile app) gets none and must
	 * use PKCE. Runs as the signed-in admin whose request `headers` are
	 * passed: better-auth checks that session against `clientPrivileges` even
	 * for its server-only admin endpoint.
	 *
	 * @throws When better-auth rejects the input, or when the OIDC provider
	 * isn't enabled because the Dashboard URL isn't set.
	 */
	async create(
		input: OauthAppInput,
		headers: Headers,
	): Promise<CreatedOauthApp> {
		const registered = registeredCallbacks(
			[input.environment],
			config.auth.origin,
		);
		const created = await auth.api.adminCreateOAuthClient({
			headers,
			body: {
				application_type: registered.applicationType,
				client_name: input.name,
				enable_end_session: input.enableEndSession,
				grant_types: ["authorization_code", "refresh_token"],
				redirect_uris: registered.redirectUris,
				require_pkce: input.confidential ? input.requirePkce : true,
				response_types: ["code"],
				scope: OIDC_SCOPES.join(" "),
				skip_consent: input.skipConsent,
				token_endpoint_auth_method: tokenAuthMethod(input),
			},
		});
		const environment = await OauthClientEnvironmentDTO.create(
			created.client_id,
			input.environment,
		);
		const secret = created.client_secret ?? null;
		if (secret) {
			await OauthClientSecretDTO.adoptHash({
				clientId: created.client_id,
				environmentId: environment.id,
				hint: secret.slice(-4),
				label: "Initial secret",
				secretHash: hashClientSecret(secret),
			});
			await OauthClientDTO.useSecretTable(created.client_id);
		}
		return { clientId: created.client_id, clientSecret: secret };
	}

	/**
	 * Saves an app's name and consent/logout options. Whether it's
	 * confidential is fixed at creation, its PKCE requirement is changed
	 * through `OauthClientDTO.setRequirePkce`, and its callbacks through its
	 * environments. Runs as the admin whose request `headers` are passed.
	 *
	 * @throws When better-auth rejects the update.
	 */
	async update(
		clientId: string,
		input: OauthAppSettings,
		headers: Headers,
	): Promise<void> {
		await auth.api.adminUpdateOAuthClient({
			headers,
			body: {
				client_id: clientId,
				update: {
					client_name: input.name,
					enable_end_session: input.enableEndSession,
					skip_consent: input.skipConsent,
				},
			},
		});
	}

	/**
	 * Re-registers the client's callbacks with the provider from its
	 * environments (plus the test callback), after an environment changed.
	 *
	 * @throws When no callback is left, or better-auth rejects one.
	 */
	async syncCallbacks(clientId: string, headers: Headers): Promise<void> {
		const environments =
			await OauthClientEnvironmentDTO.listForClient(clientId);
		const registered = registeredCallbacks(
			environments.map((env) => ({ redirectUris: env.redirectUris })),
			config.auth.origin,
		);
		if (registered.redirectUris.length === 0) {
			throw new Error(
				"The app needs at least one callback URL in one of its environments.",
			);
		}
		await auth.api.adminUpdateOAuthClient({
			headers,
			body: {
				client_id: clientId,
				update: {
					application_type: registered.applicationType,
					redirect_uris: registered.redirectUris,
				},
			},
		});
	}
}

export const OauthAppService = new OauthAppServiceClass();
