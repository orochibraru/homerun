import { createHash, randomBytes } from "node:crypto";
import { OauthClientDTO } from "#lib/dto/oauth-client-dto.js";
import { OauthClientSecretDTO } from "#lib/dto/oauth-client-secret-dto.js";
import { oidcEndpointBase, oidcTestCallback } from "#lib/oidc-provider.js";
import { auth } from "./auth.ts";

export const OAUTH_TEST_COOKIE = "homerun-oidc-test";

const TEST_SECRET_TTL_MS = 10 * 60 * 1000;

export interface OauthTestState {
	appId: string;
	clientId: string;
	secret: string | null;
	secretId: string | null;
	state: string;
	verifier: string;
}

export interface OauthTestStep {
	detail: string;
	label: string;
	ok: boolean;
}

export interface OauthTestResult {
	appId: string | null;
	appName: string | null;
	idTokenClaims: Record<string, unknown> | null;
	steps: OauthTestStep[];
	userinfo: Record<string, unknown> | null;
}

/** The JSON payload of a JWT, unverified: the test only displays what the app would receive. */
function jwtPayload(token: string): Record<string, unknown> | null {
	try {
		const payload = token.split(".")[1];
		return payload
			? JSON.parse(Buffer.from(payload, "base64url").toString())
			: null;
	} catch {
		return null;
	}
}

/**
 * The token request the app would send for `code`: its secret in a Basic
 * header or the body, as the client is registered, or just its id for a
 * public client.
 */
function tokenRequest(
	test: OauthTestState,
	authMethod: string,
	code: string,
	origin: string,
): Request {
	const form = new URLSearchParams({
		code,
		code_verifier: test.verifier,
		grant_type: "authorization_code",
		redirect_uri: oidcTestCallback(origin),
	});
	const headers = new Headers({
		"content-type": "application/x-www-form-urlencoded",
	});
	if (test.secret && authMethod === "client_secret_basic") {
		const pair = `${encodeURIComponent(test.clientId)}:${encodeURIComponent(test.secret)}`;
		headers.set(
			"authorization",
			`Basic ${Buffer.from(pair).toString("base64")}`,
		);
	} else {
		form.set("client_id", test.clientId);
		if (test.secret) {
			form.set("client_secret", test.secret);
		}
	}
	return new Request(`${oidcEndpointBase(origin)}/oauth2/token`, {
		body: form,
		headers,
		method: "POST",
	});
}

/** A response body as JSON, or its text wrapped as `{ error }`. */
async function readJson(response: Response): Promise<Record<string, unknown>> {
	const text = await response.text();
	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		return { error: text || `HTTP ${response.status}` };
	}
}

/** The readable reason in an OAuth error body. */
function oauthError(body: Record<string, unknown>): string {
	return String(body.error_description ?? body.error ?? "unknown error");
}

/**
 * Runs "Test sign-in" for an app: a real authorization-code flow with PKCE
 * against Homerun's own provider, signed in as the admin running it, landing
 * on Homerun's test callback, then the token exchange and a userinfo call,
 * all as the app would do them. A confidential app is tested with a secret
 * minted for the test, expiring in 10 minutes and deleted when it's done,
 * which the token endpoint refuses from anywhere but here.
 */
class OauthTestServiceClass {
	/**
	 * Starts a test: mints the PKCE verifier, state and (for a confidential
	 * app) a test secret.
	 *
	 * @returns The authorize URL to send the admin to, and the state to keep
	 *   in a cookie until the callback.
	 */
	async start(
		app: OauthClientDTO,
		origin: string,
	): Promise<{ authorizeUrl: string; state: OauthTestState }> {
		await OauthClientSecretDTO.purgeExpired();
		const verifier = randomBytes(32).toString("base64url");
		const state = randomBytes(16).toString("base64url");
		const summary = app.summary();
		const test = summary.confidential
			? await OauthClientSecretDTO.issue(
					app.clientId,
					null,
					"Test sign-in",
					new Date(Date.now() + TEST_SECRET_TTL_MS),
				)
			: null;
		const params = new URLSearchParams({
			client_id: app.clientId,
			code_challenge: createHash("sha256").update(verifier).digest("base64url"),
			code_challenge_method: "S256",
			redirect_uri: oidcTestCallback(origin),
			response_type: "code",
			scope: "openid profile email groups",
			state,
		});
		return {
			authorizeUrl: `${oidcEndpointBase(origin)}/oauth2/authorize?${params}`,
			state: {
				appId: app.id,
				clientId: app.clientId,
				secret: test?.secret ?? null,
				secretId: test?.row.summary().id ?? null,
				state,
				verifier,
			},
		};
	}

	/** The test state kept in the cookie, null when it's missing or unreadable. */
	readState(raw: string | undefined): OauthTestState | null {
		if (!raw) {
			return null;
		}
		try {
			return JSON.parse(raw) as OauthTestState;
		} catch {
			return null;
		}
	}

	/**
	 * Finishes a test from the callback's query: checks the state, redeems the
	 * code, reads userinfo, and deletes the test secret whatever happened.
	 *
	 * @returns Each step with whether it worked, and what the app would have
	 *   received.
	 */
	async finish(
		test: OauthTestState | null,
		query: URLSearchParams,
		origin: string,
	): Promise<OauthTestResult> {
		const app = test ? await OauthClientDTO.get(test.appId) : null;
		const result: OauthTestResult = {
			appId: app?.id ?? null,
			appName: app?.name ?? null,
			idTokenClaims: null,
			steps: [],
			userinfo: null,
		};
		try {
			if (!test || !app) {
				result.steps.push({
					detail: "No test in progress: start one from the app's page.",
					label: "Start",
					ok: false,
				});
				return result;
			}
			const error = query.get("error");
			if (error) {
				result.steps.push({
					detail: query.get("error_description") ?? error,
					label: "Authorize",
					ok: false,
				});
				return result;
			}
			const code = query.get("code");
			if (!code || query.get("state") !== test.state) {
				result.steps.push({
					detail: "The callback didn't carry this test's code and state.",
					label: "Authorize",
					ok: false,
				});
				return result;
			}
			result.steps.push({
				detail: "Signed in and sent back to the callback with a code.",
				label: "Authorize",
				ok: true,
			});

			const endpointBase = oidcEndpointBase(origin);
			const tokenResponse = await auth.handler(
				tokenRequest(test, app.tokenEndpointAuthMethod, code, origin),
			);
			const tokens = await readJson(tokenResponse);
			if (!tokenResponse.ok || typeof tokens.access_token !== "string") {
				result.steps.push({
					detail: oauthError(tokens),
					label: "Token exchange",
					ok: false,
				});
				return result;
			}
			result.idTokenClaims =
				typeof tokens.id_token === "string"
					? jwtPayload(tokens.id_token)
					: null;
			result.steps.push({
				detail: `Got an access token${tokens.id_token ? ", an ID token" : ""}${tokens.refresh_token ? " and a refresh token" : ""}.`,
				label: "Token exchange",
				ok: true,
			});

			const userinfoResponse = await auth.handler(
				new Request(`${endpointBase}/oauth2/userinfo`, {
					headers: { authorization: `Bearer ${tokens.access_token}` },
				}),
			);
			const userinfo = await readJson(userinfoResponse);
			if (!userinfoResponse.ok) {
				result.steps.push({
					detail: oauthError(userinfo),
					label: "Userinfo",
					ok: false,
				});
				return result;
			}
			result.userinfo = userinfo;
			result.steps.push({
				detail: "Read the signed-in user's claims.",
				label: "Userinfo",
				ok: true,
			});
			return result;
		} finally {
			if (test?.secretId) {
				await (
					await OauthClientSecretDTO.get(test.clientId, test.secretId)
				)?.delete();
			}
		}
	}
}

export const OauthTestService = new OauthTestServiceClass();
