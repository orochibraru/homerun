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
    networkName: z.string().default("homerun-network"),
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

/** The plain-value shape InstanceSettingsDTO.toConfigOverride() produces — kept here rather than imported from the DTO so this module stays DB-free (see applyInstanceSettings below). */
export interface InstanceSettingsOverride {
  authCheckUrl?: string | null;
  authCrossSubdomainCookies?: boolean | null;
  authOrigin?: string | null;
  baseDomain?: string | null;
  dockerNetworkName?: string | null;
  dockerSocketPath?: string | null;
  oauthProviders?: PenombreConfig["auth"]["oauthProviders"];
  smtpEnabled?: boolean | null;
  smtpFrom?: string | null;
  smtpHost?: string | null;
  smtpPassword?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
  traefikCertResolver?: string | null;
  traefikDynamicConfigDir?: string | null;
  traefikEntrypoint?: string | null;
}

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

/**
 * A non-secret subset of the env defaults, safe to send to the client as
 * placeholder text on the /settings page ("blank = falls back to this").
 * Deliberately omits auth.secret and smtp.password — those never get
 * echoed back to the browser even as an env-default hint.
 */
export function envDefaultsForDisplay() {
  return {
    authCheckUrl: envDefaults.authCheckUrl,
    authOrigin: envDefaults.auth.origin,
    baseDomain: envDefaults.baseDomain,
    dockerNetworkName: envDefaults.docker.networkName,
    dockerSocketPath: envDefaults.docker.socketPath,
    smtpEnabled: envDefaults.smtp.enabled,
    smtpFrom: envDefaults.smtp.from ?? null,
    smtpHost: envDefaults.smtp.host ?? null,
    smtpPort: envDefaults.smtp.port ?? null,
    smtpSecure: envDefaults.smtp.secure ?? false,
    smtpUser: envDefaults.smtp.user ?? null,
    traefikCertResolver: envDefaults.traefik.certResolver,
    traefikDynamicConfigDir: envDefaults.traefik.dynamicConfigDir ?? null,
    traefikEntrypoint: envDefaults.traefik.entrypoint,
  };
}

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

// The env-only baseline — applyInstanceSettings() below always recomputes
// against this, never against the current `config`, so clearing a DB
// override reverts to the env value instead of going stale.
const envDefaults = parseConfig();

// `config` is a stable object reference every other module imports and
// reads properties off live — mutated in place (never reassigned) so a
// settings change is visible everywhere without re-importing anything.
export const config: PenombreConfig = structuredClone(envDefaults);

/**
 * Merges DB-backed instance settings (see InstanceSettingsDTO) over the env
 * defaults, in place. Called once at boot (hooks.server.ts's init(), before
 * the server accepts requests) and again after every settings save so
 * changes apply live — no process restart needed. Deliberately doesn't
 * import the DTO or the db itself: db/lib.ts imports this module for
 * `dbPath`, so this module must stay a leaf to avoid a circular import.
 */
export function applyInstanceSettings(
  override: InstanceSettingsOverride = {}
): void {
  config.authCheckUrl = override.authCheckUrl ?? envDefaults.authCheckUrl;
  config.baseDomain = override.baseDomain ?? envDefaults.baseDomain;
  config.auth.crossSubdomainCookies =
    override.authCrossSubdomainCookies ??
    envDefaults.auth.crossSubdomainCookies;
  config.auth.oauthProviders =
    override.oauthProviders ?? envDefaults.auth.oauthProviders;
  config.auth.origin = override.authOrigin ?? envDefaults.auth.origin;
  config.docker.networkName =
    override.dockerNetworkName ?? envDefaults.docker.networkName;
  config.docker.socketPath =
    override.dockerSocketPath ?? envDefaults.docker.socketPath;
  config.smtp.enabled = override.smtpEnabled ?? envDefaults.smtp.enabled;
  config.smtp.from = override.smtpFrom ?? envDefaults.smtp.from;
  config.smtp.host = override.smtpHost ?? envDefaults.smtp.host;
  config.smtp.password = override.smtpPassword ?? envDefaults.smtp.password;
  config.smtp.port = override.smtpPort ?? envDefaults.smtp.port;
  config.smtp.secure = override.smtpSecure ?? envDefaults.smtp.secure;
  config.smtp.user = override.smtpUser ?? envDefaults.smtp.user;
  config.traefik.certResolver =
    override.traefikCertResolver ?? envDefaults.traefik.certResolver;
  config.traefik.dynamicConfigDir =
    override.traefikDynamicConfigDir ?? envDefaults.traefik.dynamicConfigDir;
  config.traefik.entrypoint =
    override.traefikEntrypoint ?? envDefaults.traefik.entrypoint;
}
