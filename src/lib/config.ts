import Bun from "bun";
import { z } from "zod";

export const configSchema = z.object({
  auth: z.object({
    // Opt-in, off by default: scopes the session cookie to
    // ".<baseDomain>" instead of the exact host, so a session started on
    // this app's own origin is also valid on a gated deployed service's
    // subdomain (see docker/labels.ts's authRequired forwardAuth
    // middleware) — without this, "Require login" still blocks
    // unauthenticated visitors, it just can't recognize an
    // already-signed-in admin on a *different* subdomain. Widens the
    // cookie's scope across every subdomain of baseDomain, which is a
    // real tradeoff worth deciding deliberately rather than defaulting on.
    crossSubdomainCookies: z.boolean().default(false),
    oauthProviders: z
      .array(
        z.object({
          clientId: z.string(),
          clientSecret: z.string(),
          discoveryUrl: z.string(),
          enabled: z.boolean().default(false),
          name: z.string(),
          pkce: z.boolean().default(true),
          scopes: z.array(z.string()).default([]),
        })
      )
      .default([]),
    origin: z.string().default("http://localhost:3000"),
    secret: z.string().default("default-secret"),
  }),
  // URL Traefik's forwardAuth middleware calls to gatekeep a service with
  // authRequired=true (see docker/labels.ts). Must be reachable *from
  // inside the Traefik container*, not from the host — since this app
  // isn't containerized, that's usually host.docker.internal (works out
  // of the box on Docker Desktop; on Linux, compose.yaml's Traefik
  // service needs `extra_hosts: ["host.docker.internal:host-gateway"]`
  // added, which this app can't do for you).
  authCheckUrl: z.string(),
  // Base domain deployed services get subdomained under: <slug>.<baseDomain>
  baseDomain: z.string().default("localhost"),
  dbPath: z.string().default("./database.db"),
  docker: z.object({
    networkName: z.string().default("localrun-network"),
    socketPath: z.string().default("/var/run/docker.sock"),
  }),
  logFormat: z.enum(["console", "json"]).default("console"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  port: z.number().default(3000),
  smtp: z.object({
    enabled: z.boolean().default(false),
    from: z.string().optional(),
    host: z.string().optional(),
    password: z.string().optional(),
    port: z.number().optional(),
    secure: z.boolean().optional(),
    user: z.string().optional(),
  }),
  traefik: z.object({
    certResolver: z.string().default("letsencrypt"),
    // Where custom SSL cert/key files + per-domain dynamic-config YAML
    // get written (see docker/custom-ssl.ts) — unset by default, which
    // makes the feature a no-op (services can still store a cert/key,
    // it just never gets written anywhere until this is configured).
    // Must be the same host path bind-mounted into the Traefik
    // container per compose.yaml's commented-out example, with its file
    // provider enabled — an opt-in the admin performs themselves, this
    // app never touches the Traefik container's own config.
    dynamicConfigDir: z.string().optional(),
    entrypoint: z.string().default("websecure"),
  }),
});

export type PenombreConfig = z.infer<typeof configSchema>;

export const parseConfig = (): PenombreConfig => {
  const envConfig = {
    auth: {
      crossSubdomainCookies: Bun.env.AUTH_CROSS_SUBDOMAIN === "true",
      origin: Bun.env.ORIGIN,
      // AUTH_SECRET is the app-local override; BETTER_AUTH_SECRET is the
      // name better-auth's own CLI (`auth generate`) expects by
      // convention, and what `.env` sets — fall back to it so the
      // generated secret is actually used instead of the zod default.
      secret: Bun.env.AUTH_SECRET ?? Bun.env.BETTER_AUTH_SECRET,
    },
    // Falls back to host.docker.internal on the app's own port — right
    // for the common case (Docker Desktop, or Linux with the
    // host-gateway extra_hosts entry documented above); override
    // explicitly for anything else.
    authCheckUrl:
      Bun.env.AUTH_CHECK_URL ??
      `http://host.docker.internal:${Bun.env.PORT ?? 3000}/api/v1/auth-check`,
    baseDomain: Bun.env.BASE_DOMAIN,
    dbPath: Bun.env.DB_PATH,
    docker: {
      networkName: Bun.env.DOCKER_NETWORK_NAME,
      socketPath: Bun.env.DOCKER_SOCKET_PATH,
    },
    logFormat: Bun.env.LOG_FORMAT as PenombreConfig["logFormat"],
    logLevel: Bun.env.LOG_LEVEL as PenombreConfig["logLevel"],
    port: Bun.env.PORT ? Number.parseInt(Bun.env.PORT, 10) : undefined,
    smtp: {
      enabled: Bun.env.SMTP_ENABLED === "true",
      from: Bun.env.SMTP_FROM,
      host: Bun.env.SMTP_HOST,
      password: Bun.env.SMTP_PASSWORD,
      port: Bun.env.SMTP_PORT
        ? Number.parseInt(Bun.env.SMTP_PORT, 10)
        : undefined,
      secure: Bun.env.SMTP_SECURE === "true",
      user: Bun.env.SMTP_USER,
    },
    traefik: {
      certResolver: Bun.env.TRAEFIK_CERT_RESOLVER,
      dynamicConfigDir: Bun.env.TRAEFIK_DYNAMIC_CONFIG_DIR,
      entrypoint: Bun.env.TRAEFIK_ENTRYPOINT,
    },
  };
  return configSchema.parse(envConfig);
};

export function isSmtpEnabled(): boolean {
  const enabledInConfig = config.smtp?.enabled;
  const configuredProperly =
    config.smtp?.host &&
    config.smtp?.port &&
    config.smtp?.user &&
    config.smtp?.password &&
    config.smtp?.from;

  if (enabledInConfig && !configuredProperly) {
    console.warn(
      "SMTP is enabled in configuration but missing required fields. Email verification will not work."
    );
    return false;
  }

  return !!(enabledInConfig && configuredProperly);
}

export const config = parseConfig();
