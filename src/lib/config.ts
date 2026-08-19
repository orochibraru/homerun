import Bun from "bun";
import * as zod from "zod";

export const configSchema = zod.z.object({
  auth: zod.z.object({
    oauthProviders: zod.z
      .array(
        zod.z.object({
          clientId: zod.z.string(),
          clientSecret: zod.z.string(),
          discoveryUrl: zod.z.string(),
          enabled: zod.z.boolean().default(false),
          name: zod.z.string(),
          pkce: zod.z.boolean().default(true),
          scopes: zod.z.array(zod.z.string()).default([]),
        })
      )
      .default([]),
    origin: zod.z.string().default("http://localhost:3000"),
    secret: zod.z.string().default("default-secret"),
  }),
  // Base domain deployed services get subdomained under: <slug>.<baseDomain>
  baseDomain: zod.z.string().default("localhost"),
  dbPath: zod.z.string().default("./database.db"),
  docker: zod.z.object({
    networkName: zod.z.string().default("localrun-network"),
    socketPath: zod.z.string().default("/var/run/docker.sock"),
  }),
  logFormat: zod.z.enum(["console", "json"]).default("console"),
  logLevel: zod.z.enum(["debug", "info", "warn", "error"]).default("info"),
  port: zod.z.number().default(3000),
  smtp: zod.z.object({
    enabled: zod.z.boolean().default(false),
    from: zod.z.string().optional(),
    host: zod.z.string().optional(),
    password: zod.z.string().optional(),
    port: zod.z.number().optional(),
    secure: zod.z.boolean().optional(),
    user: zod.z.string().optional(),
  }),
  traefik: zod.z.object({
    certResolver: zod.z.string().default("letsencrypt"),
    entrypoint: zod.z.string().default("websecure"),
  }),
});

export type PenombreConfig = zod.z.infer<typeof configSchema>;

export const parseConfig = (): PenombreConfig => {
  const envConfig = {
    auth: {
      origin: Bun.env.ORIGIN,
      // AUTH_SECRET is the app-local override; BETTER_AUTH_SECRET is the
      // name better-auth's own CLI (`auth generate`) expects by
      // convention, and what `.env` sets — fall back to it so the
      // generated secret is actually used instead of the zod default.
      secret: Bun.env.AUTH_SECRET ?? Bun.env.BETTER_AUTH_SECRET,
    },
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
