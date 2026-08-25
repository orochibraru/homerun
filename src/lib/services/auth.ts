import process from "node:process";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, bearer, genericOAuth, openAPI } from "better-auth/plugins";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { building, dev } from "$app/environment";
import { getRequestEvent } from "$app/server";
import { config, isSmtpEnabled } from "$lib/config";
import { Logger } from "$lib/logger";
import { db } from "$lib/server/db/lib";
import * as schema from "$lib/server/db/schema";
import { AdminService } from "./admin.service.ts";
import { EmailService } from "./email.service.ts";
import { UserService } from "./user.service.ts";

const logger = new Logger("Auth");

// Doesn't throw : ORIGIN (or the Core section's Base domain + Use HTTPS on
// /settings, see config.ts's applyInstanceSettings) can also be supplied
// from the DB after boot (hooks.server.ts's init() calls rebuildAuth() once
// instance settings are loaded, before the server accepts requests), so
// nothing is configured *yet* at this module's own import time isn't
// actually an error, just worth a heads-up for anyone who hasn't set either.
if (!(process.env.ORIGIN || dev || building)) {
	logger.warn(
		"Neither ORIGIN nor a Base domain (Settings → General) is configured yet : the origin will be derived per-request until one is set.",
	);
}

/**
 * Builds the better-auth instance from the current `config` (env defaults
 * merged with any DB-backed instance settings : see $lib/config.ts). Wrapped
 * in a function, rather than inlined into a single `betterAuth({...})` call
 * assigned once, so OAuth provider changes saved on the Settings page can
 * take effect live: rebuildAuth() below reassigns the exported `auth`
 * binding, and since every consumer reads `auth.*` per-request rather than
 * destructuring it at import time, the new instance is picked up
 * immediately everywhere without a process restart.
 */
function buildAuth() {
	return betterAuth({
		advanced: {
			// Opt-in (AUTH_CROSS_SUBDOMAIN=true) : see config.ts for the tradeoff.
			// Required for a signed-in admin to be recognized on a gated deployed
			// service's subdomain without a separate login there.
			...(config.auth.crossSubdomainCookies
				? {
						crossSubDomainCookies: {
							domain: `.${config.baseDomain}`,
							enabled: true,
						},
					}
				: {}),
		},
		basePath: "/api/v1/auth",
		// Deliberately never pinned to config.auth.origin (the Core section's
		// Base domain + Use HTTPS on /settings/onboarding). Real, tested-in-
		// review bug this replaced: better-auth's svelteKitHandler only
		// forwards a request to its own handler when the request's origin
		// matches options.baseURL's origin exactly (confirmed in
		// node_modules/better-auth/dist/integrations/svelte-kit.mjs's
		// isAuthPath : `if (_url.origin !== baseURL.origin) return false`) ;
		// with baseURL pinned, *every* /api/v1/auth/* call from any origin
		// other than the exact configured one 404s instead of reaching
		// better-auth at all (SvelteKit's own router has no route for that
		// path, only better-auth does), including sign-in itself. That's a
		// real, easy-to-hit lockout : the configured Base domain frequently
		// doesn't match how the instance is actually being reached yet
		// (behind a reverse proxy before DNS/TLS are fully wired, a bare IP
		// or different port during initial setup, etc.), and onboarding
		// makes Base domain mandatory, so this used to break auth
		// immediately after finishing it. Leaving baseURL undefined makes
		// svelteKitHandler derive the origin from each incoming request
		// instead (same "port-mismatch" reasoning this comment used to give
		// only for the *unconfigured* case, now applied unconditionally) :
		// isAuthPath's own baseURL then always has the same origin as the
		// request by construction, so it can never mismatch. config.auth.origin
		// has no other consumer in this codebase (grep it), Base domain
		// itself is still what Traefik routing (config.baseDomain) uses.

		database: drizzleAdapter(db, {
			provider: "sqlite",
			schema,
		}),
		databaseHooks: {
			user: {
				create: {
					// The very first account on the instance becomes admin,
					// regardless of which path created it (self-service sign-up is
					// the only one reachable while hasAnyUser() is still false : see
					// hooks.server.ts). Real, tested-in-review finding: gating this
					// on "!user.role" doesn't work : the admin plugin registers its
					// own databaseHooks.user.create.before (setting role to
					// defaultRole) via its init(), and depending on hook-merge order
					// that can run *before* this one, making `user.role` already
					// truthy by the time this hook sees it (verified live: the
					// bootstrap account came out "developer", not "admin", with that
					// guard). Checking hasAnyUser() directly instead sidesteps hook
					// ordering entirely : both hooks run pre-insert, so it's still
					// reliably false only before the very first user exists. Every
					// other creation path (admin-direct-create, invite-accept)
					// always passes an explicit role and runs once hasAnyUser() is
					// already true, so this never overrides those.
					before: async (user) => {
						if (await AdminService.hasAnyUser()) {
							return;
						}
						return { data: { ...user, role: "admin" } };
					},
				},
			},
		},
		emailAndPassword: {
			disableSignUp: false,
			enabled: true,
			minPasswordLength: 12,
		},
		emailVerification: {
			sendOnSignUp: isSmtpEnabled(),
			sendVerificationEmail: async (params) => {
				const fullUrl = new URL(params.url);
				// If not hostname, add it
				if (!fullUrl.hostname) {
					fullUrl.hostname = "localhost:5173"; // Change this to your frontend domain
					fullUrl.protocol = "http:"; // or 'https:' in production
				}
				const email = new EmailService({
					content: `Click the link to verify your email: ${fullUrl.toString()}`,
					subject: "Verify your email address",
					to: params.user.email,
				});
				await email.send();
			},
		},
		logger: {
			level: dev ? "debug" : config.logLevel,
			log: (level, message, ...metadata) => {
				// Send logs to a custom logging service
				logger.log({
					level,
					message,
					metadata,
				});
			},
		},
		plugins: [
			sveltekitCookies(getRequestEvent),
			openAPI({
				disableDefaultReference: true,
				path: "/openapi",
			}),
			// Real, tested-in-review finding, from actually driving the REST
			// API hard enough (this app's own new integration test suite,
			// tests/integration/) to hit it : apiKey()'s own default rate
			// limit, unset here before, is 10 requests per *24 hours* per key
			// (node_modules/@better-auth/api-key's own default). Every
			// api-key-authenticated request (hooks.server.ts's authHandler
			// calls verifyApiKey() for each one) counts against it, so the
			// REST API, the CLI built on it, and any dashboard-side polling
			// using a key would all get silently 401'd (hooks.server.ts
			// treats a rate-limited verifyApiKey() result identically to an
			// actually-invalid key) after just 10 calls, not a deliberate
			// choice anywhere in this app's own design. 300/minute is
			// generous for legitimate CLI/dashboard use while still keeping
			// *some* abuse protection, rather than removing rate limiting
			// outright.
			apiKey({ rateLimit: { maxRequests: 300, timeWindow: 60_000 } }),
			passkey(),
			// "developer" is the sane fallback default : every real creation
			// path (admin-direct-create, invite-accept) always passes an
			// explicit role, and the bootstrap-admin case is handled by the
			// databaseHooks below, not this option.
			admin({ defaultRole: "developer" }),
			bearer(),
			genericOAuth({
				config: config.auth.oauthProviders.map((provider) => ({
					clientId: provider.clientId,
					clientSecret: provider.clientSecret,
					discoveryUrl: provider.discoveryUrl,
					enabled: provider.enabled,
					pkce: provider.pkce,
					providerId: provider.name,
					scopes: provider.scopes,
				})),
			}),
		],
		rateLimit: {
			// Disabled in dev for easier testing, and also when
			// HOMERUN_DISABLE_AUTH_RATE_LIMIT=1 : real, tested finding building
			// tests/e2e/'s own sign-in/sign-out coverage — better-auth's rate
			// limiter has an undocumented-in-config default "special rule" (see
			// its own rate-limiter/index.mjs's getDefaultSpecialRules) capping
			// any "/sign-in"/"/sign-up"-prefixed path at 3 requests per 10
			// seconds, well below this `max`/`window`, and unaffected by them.
			// A handful of E2E specs signing in/up against a real production
			// build (`dev` is false there, same as a real deployment) tripped it
			// immediately. `HOMERUN_DISABLE_AUTH_RATE_LIMIT` is set only by
			// tests/e2e/support/bootstrap-runtime.ts's spawned app, never in
			// production, same "test-only env escape hatch" shape as
			// HOMERUN_SKIP_INTEGRATION_SETUP elsewhere in this repo.
			enabled: !dev && process.env.HOMERUN_DISABLE_AUTH_RATE_LIMIT !== "1",
			max: 100, // limit each IP to 100 requests per window
			window: 15 * 60 * 1000, // 15 minutes
		},
		secret: config.auth.secret,
		user: {
			deleteUser: {
				// Extracted to user.service.ts : the admin Users page's "remove
				// user" action needs the exact same cleanup and can't get it for
				// free from better-auth's admin.removeUser (see that module's
				// docstring for why). Thin wrapper here keeps self-service account
				// deletion unchanged.
				beforeDelete: async (user) => {
					await UserService.cleanupUserResources(user.id);
				},
				enabled: true,
			},
		},
	});
}

export let auth = buildAuth();

/** Reconstructs `auth` from the current config : see buildAuth()'s docstring. */
export function rebuildAuth(): void {
	auth = buildAuth();
	logger.info("Rebuilt auth instance from updated instance settings");
}

export type AuthType = typeof auth.$Infer.Session;
