import Bun from "bun";
import * as zod from "zod";

export const configSchema = zod.z.object({
	port: zod.z.number().default(3000),
	logLevel: zod.z.enum(["debug", "info", "warn", "error"]).default("info"),
	logFormat: zod.z.enum(["console", "json"]).default("console"),
	dbPath: zod.z.string().default("./database.db"),
	auth: zod.z.object({
		origin: zod.z.string().default("http://localhost:3000"),
		secret: zod.z.string().default("default-secret"),
		oauthProviders: zod.z
			.array(
				zod.z.object({
					name: zod.z.string(),
					clientId: zod.z.string(),
					clientSecret: zod.z.string(),
					discoveryUrl: zod.z.string(),
					pkce: zod.z.boolean().default(true),
					scopes: zod.z.array(zod.z.string()).default([]),
					enabled: zod.z.boolean().default(false),
				}),
			)
			.default([]),
	}),
	smtp: zod.z.object({
		enabled: zod.z.boolean().default(false),
		host: zod.z.string().optional(),
		port: zod.z.number().optional(),
		secure: zod.z.boolean().optional(),
		user: zod.z.string().optional(),
		password: zod.z.string().optional(),
		from: zod.z.string().optional(),
	}),
	docker: zod.z.object({
		socketPath: zod.z.string().default("/var/run/docker.sock"),
		networkName: zod.z.string().default("localrun-network"),
	}),
	// Base domain deployed services get subdomained under: <slug>.<baseDomain>
	baseDomain: zod.z.string().default("localhost"),
	traefik: zod.z.object({
		entrypoint: zod.z.string().default("websecure"),
		certResolver: zod.z.string().default("letsencrypt"),
	}),
});

export type PenombreConfig = zod.z.infer<typeof configSchema>;

export const parseConfig = (): PenombreConfig => {
	const envConfig = {
		port: Bun.env.PORT ? Number.parseInt(Bun.env.PORT, 10) : undefined,
		logLevel: Bun.env.LOG_LEVEL as PenombreConfig["logLevel"],
		logFormat: Bun.env.LOG_FORMAT as PenombreConfig["logFormat"],
		dbPath: Bun.env.DB_PATH,
		auth: {
			origin: Bun.env.ORIGIN,
			// AUTH_SECRET is the app-local override; BETTER_AUTH_SECRET is the
			// name better-auth's own CLI (`auth generate`) expects by
			// convention, and what `.env` sets — fall back to it so the
			// generated secret is actually used instead of the zod default.
			secret: Bun.env.AUTH_SECRET ?? Bun.env.BETTER_AUTH_SECRET,
		},
		smtp: {
			enabled: Bun.env.SMTP_ENABLED === "true",
			host: Bun.env.SMTP_HOST,
			port: Bun.env.SMTP_PORT
				? Number.parseInt(Bun.env.SMTP_PORT, 10)
				: undefined,
			secure: Bun.env.SMTP_SECURE === "true",
			user: Bun.env.SMTP_USER,
			password: Bun.env.SMTP_PASSWORD,
			from: Bun.env.SMTP_FROM,
		},
		docker: {
			socketPath: Bun.env.DOCKER_SOCKET_PATH,
			networkName: Bun.env.DOCKER_NETWORK_NAME,
		},
		baseDomain: Bun.env.BASE_DOMAIN,
		traefik: {
			entrypoint: Bun.env.TRAEFIK_ENTRYPOINT,
			certResolver: Bun.env.TRAEFIK_CERT_RESOLVER,
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
			"SMTP is enabled in configuration but missing required fields. Email verification will not work.",
		);
		return false;
	}

	return !!(enabledInConfig && configuredProperly);
}

export const config = parseConfig();
