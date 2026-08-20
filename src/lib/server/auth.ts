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
// biome-ignore lint/performance/noNamespaceImport: drizzleAdapter needs the whole schema module (every table), not a hand-picked subset.
import * as schema from "$lib/server/db/schema";
import { Email } from "$lib/server/email";
import { hasAnyUser } from "$lib/server/onboarding";
import { cleanupUserResources } from "$lib/server/user-cleanup";

if (!(process.env.ORIGIN || dev || building)) {
  throw new Error("ORIGIN environment variable is not set");
}

const logger = new Logger("Auth");

/**
 * Builds the better-auth instance from the current `config` (env defaults
 * merged with any DB-backed instance settings — see $lib/config.ts). Wrapped
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
      // Opt-in (AUTH_CROSS_SUBDOMAIN=true) — see config.ts for the tradeoff.
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
    // Use ORIGIN env-var when explicitly set (production).
    // In dev ORIGIN is often unset; leaving baseURL undefined makes
    // svelteKitHandler derive the origin from each incoming request,
    // which avoids the port-mismatch 404 on /api/v1/auth/*.
    baseURL: process.env.ORIGIN,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    databaseHooks: {
      user: {
        create: {
          // The very first account on the instance becomes admin,
          // regardless of which path created it (self-service sign-up is
          // the only one reachable while hasAnyUser() is still false — see
          // hooks.server.ts). Real, tested-in-review finding: gating this
          // on "!user.role" doesn't work — the admin plugin registers its
          // own databaseHooks.user.create.before (setting role to
          // defaultRole) via its init(), and depending on hook-merge order
          // that can run *before* this one, making `user.role` already
          // truthy by the time this hook sees it (verified live: the
          // bootstrap account came out "developer", not "admin", with that
          // guard). Checking hasAnyUser() directly instead sidesteps hook
          // ordering entirely — both hooks run pre-insert, so it's still
          // reliably false only before the very first user exists. Every
          // other creation path (admin-direct-create, invite-accept)
          // always passes an explicit role and runs once hasAnyUser() is
          // already true, so this never overrides those.
          before: async (user) => {
            if (await hasAnyUser()) {
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
        const email = new Email({
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
      apiKey(),
      passkey(),
      // "developer" is the sane fallback default — every real creation
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
      enabled: !dev, // Disable rate limiting in development for easier testing
      max: 100, // limit each IP to 100 requests per window
      window: 15 * 60 * 1000, // 15 minutes
    },
    secret: config.auth.secret,
    user: {
      deleteUser: {
        // Extracted to user-cleanup.ts — the admin Users page's "remove
        // user" action needs the exact same cleanup and can't get it for
        // free from better-auth's admin.removeUser (see that module's
        // docstring for why). Thin wrapper here keeps self-service account
        // deletion unchanged.
        beforeDelete: async (user) => {
          await cleanupUserResources(user.id);
        },
        enabled: true,
      },
    },
  });
}

export let auth = buildAuth();

/** Reconstructs `auth` from the current config — see buildAuth()'s docstring. */
export function rebuildAuth(): void {
  auth = buildAuth();
  logger.info("Rebuilt auth instance from updated instance settings");
}

export type AuthType = typeof auth.$Infer.Session;
