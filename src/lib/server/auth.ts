import process from "node:process";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, bearer, genericOAuth, openAPI } from "better-auth/plugins";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { eq } from "drizzle-orm";
import { building, dev } from "$app/environment";
import { getRequestEvent } from "$app/server";
import { config, isSmtpEnabled } from "$lib/config";
import { Logger } from "$lib/logger";
import { db } from "$lib/server/db/lib";
// biome-ignore lint/performance/noNamespaceImport: drizzleAdapter needs the whole schema module (every table), not a hand-picked subset.
import * as schema from "$lib/server/db/schema";
import { removeContainer } from "$lib/server/docker/service";
import { Email } from "$lib/server/email";

if (!(process.env.ORIGIN || dev || building)) {
  throw new Error("ORIGIN environment variable is not set");
}

const logger = new Logger("Auth");

export const auth = betterAuth({
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
    admin(),
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
      // better-auth's own internalAdapter.deleteUser only cleans up its
      // own session/account rows — it has no knowledge of our
      // service/deployment tables, and PRAGMA foreign_keys is never
      // enabled on the sqlite connection, so onDelete:cascade in the
      // schema is inert. Worse, leaving this out would leak running
      // Docker containers on the host. Clean up explicitly, before the
      // user row (and better-auth's cascade of it) goes away.
      beforeDelete: async (user) => {
        const services = await db
          .select()
          .from(schema.service)
          .where(eq(schema.service.userId, user.id));

        logger.info(
          `Deleting account: user=${user.id} services=${services.length}`
        );

        await Promise.all(
          services
            .filter((svc) => svc.containerId)
            .map((svc) =>
              removeContainer(svc.containerId as string, {
                force: true,
              }).catch(() => {
                // Already gone on the host — fine, keep cleaning up.
              })
            )
        );

        await db
          .delete(schema.deployment)
          .where(eq(schema.deployment.userId, user.id));
        await db
          .delete(schema.service)
          .where(eq(schema.service.userId, user.id));
        logger.info(`Account deletion cleanup complete: user=${user.id}`);
      },
      enabled: true,
    },
  },
});

export type AuthType = typeof auth.$Infer.Session;
