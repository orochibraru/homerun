import Bun from "bun";
import { z } from "zod";

export const configSchema = z.object({
  auth: z.object({
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
    entrypoint: z.string().default("websecure"),
  }),
});

export type PenombreConfig = z.infer<typeof configSchema>;

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
