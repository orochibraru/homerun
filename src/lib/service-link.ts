import type { ParsedEnvVar } from "$lib/env-parse";

export type LinkFormat = "url" | "jdbc" | "vars";

export type LinkEngineId =
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis"
	| "rabbitmq"
	| "generic";

export interface LinkEngine {
	defaultPort: number;
	defaultUrlKey: string;
	defaultVarPrefix: string;
	id: LinkEngineId;
	label: string;
	supportsJdbc: boolean;
}

export interface LinkTargetService {
	containerPort: number;
	envVars: Record<string, string>;
	image: string;
	name: string;
	slug: string;
}

export interface BuildLinkEnvParams {
	format: LinkFormat;
	prefix: string;
	target: LinkTargetService;
	urlKey: string;
}

const ENGINES: Record<LinkEngineId, LinkEngine> = {
	generic: {
		defaultPort: 80,
		defaultUrlKey: "SERVICE_URL",
		defaultVarPrefix: "SERVICE",
		id: "generic",
		label: "HTTP service",
		supportsJdbc: false,
	},
	mariadb: {
		defaultPort: 3306,
		defaultUrlKey: "MYSQL_URL",
		defaultVarPrefix: "MYSQL",
		id: "mariadb",
		label: "MariaDB",
		supportsJdbc: true,
	},
	mongo: {
		defaultPort: 27_017,
		defaultUrlKey: "MONGO_URL",
		defaultVarPrefix: "MONGO",
		id: "mongo",
		label: "MongoDB",
		supportsJdbc: false,
	},
	mysql: {
		defaultPort: 3306,
		defaultUrlKey: "MYSQL_URL",
		defaultVarPrefix: "MYSQL",
		id: "mysql",
		label: "MySQL",
		supportsJdbc: true,
	},
	postgres: {
		defaultPort: 5432,
		defaultUrlKey: "POSTGRES_URL",
		defaultVarPrefix: "POSTGRES",
		id: "postgres",
		label: "PostgreSQL",
		supportsJdbc: true,
	},
	rabbitmq: {
		defaultPort: 5672,
		defaultUrlKey: "AMQP_URL",
		defaultVarPrefix: "AMQP",
		id: "rabbitmq",
		label: "RabbitMQ",
		supportsJdbc: false,
	},
	redis: {
		defaultPort: 6379,
		defaultUrlKey: "REDIS_URL",
		defaultVarPrefix: "REDIS",
		id: "redis",
		label: "Redis",
		supportsJdbc: false,
	},
};

const IMAGE_MATCHERS: Array<[RegExp, LinkEngineId]> = [
	[/(^|\/)(timescale\/timescaledb|postgis\/postgis|.*postgres.*)/, "postgres"],
	[/(^|\/).*mariadb.*/, "mariadb"],
	[/(^|\/).*(mysql|percona).*/, "mysql"],
	[/(^|\/).*(mongo).*/, "mongo"],
	[/(^|\/).*(redis|valkey|dragonfly).*/, "redis"],
	[/(^|\/).*(rabbitmq).*/, "rabbitmq"],
];

export function detectLinkEngine(image: string): LinkEngine {
	const normalized = image.toLowerCase();
	for (const [pattern, id] of IMAGE_MATCHERS) {
		if (pattern.test(normalized)) {
			return ENGINES[id];
		}
	}
	return ENGINES.generic;
}

export function envKeyPrefix(slug: string): string {
	const cleaned = slug
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return /^[A-Z]/.test(cleaned) ? cleaned : `SVC_${cleaned}`;
}

export function defaultVarPrefix(
	engine: LinkEngine,
	target: LinkTargetService,
): string {
	return engine.id === "generic"
		? envKeyPrefix(target.slug)
		: engine.defaultVarPrefix;
}

export function defaultUrlKey(
	engine: LinkEngine,
	target: LinkTargetService,
): string {
	return engine.id === "generic"
		? `${envKeyPrefix(target.slug)}_URL`
		: engine.defaultUrlKey;
}

interface Credentials {
	database: string | null;
	password: string;
	scheme: string;
	user: string;
}

function firstOf(
	envVars: Record<string, string>,
	keys: string[],
	fallback = "",
): string {
	for (const key of keys) {
		const value = envVars[key];
		if (value) {
			return value;
		}
	}
	return fallback;
}

function credentialsFor(
	engine: LinkEngine,
	target: LinkTargetService,
): Credentials {
	const env = target.envVars;
	switch (engine.id) {
		case "postgres":
			return {
				database: firstOf(
					env,
					["POSTGRES_DB"],
					firstOf(env, ["POSTGRES_USER"], "postgres"),
				),
				password: firstOf(env, ["POSTGRES_PASSWORD"]),
				scheme: "postgres",
				user: firstOf(env, ["POSTGRES_USER"], "postgres"),
			};
		case "mysql":
		case "mariadb":
			return {
				database: firstOf(env, ["MYSQL_DATABASE", "MARIADB_DATABASE"], "mysql"),
				password: firstOf(env, [
					"MYSQL_PASSWORD",
					"MARIADB_PASSWORD",
					"MYSQL_ROOT_PASSWORD",
					"MARIADB_ROOT_PASSWORD",
				]),
				scheme: "mysql",
				user: firstOf(env, ["MYSQL_USER", "MARIADB_USER"], "root"),
			};
		case "mongo":
			return {
				database: env.MONGO_INITDB_DATABASE || null,
				password: firstOf(env, ["MONGO_INITDB_ROOT_PASSWORD"]),
				scheme: "mongodb",
				user: firstOf(env, ["MONGO_INITDB_ROOT_USERNAME"], "root"),
			};
		case "redis":
			return {
				database: null,
				password: firstOf(env, ["REDIS_PASSWORD"]),
				scheme: "redis",
				user: "",
			};
		case "rabbitmq":
			return {
				database: null,
				password: firstOf(env, ["RABBITMQ_DEFAULT_PASS"], "guest"),
				scheme: "amqp",
				user: firstOf(env, ["RABBITMQ_DEFAULT_USER"], "guest"),
			};
		default:
			return { database: null, password: "", scheme: "http", user: "" };
	}
}

function authorityFor(credentials: Credentials, host: string): string {
	if (!(credentials.user || credentials.password)) {
		return host;
	}
	const user = encodeURIComponent(credentials.user);
	const password = credentials.password
		? `:${encodeURIComponent(credentials.password)}`
		: "";
	return `${user}${password}@${host}`;
}

function jdbcDriver(engine: LinkEngine): string {
	return engine.id === "postgres" ? "postgresql" : "mysql";
}

export function buildLinkUrl(
	engine: LinkEngine,
	target: LinkTargetService,
	format: "url" | "jdbc",
): string {
	const credentials = credentialsFor(engine, target);
	const port = target.containerPort || engine.defaultPort;
	const host = `${target.slug}:${port}`;
	const path = credentials.database ? `/${credentials.database}` : "";

	if (format === "jdbc") {
		const params = [
			credentials.user ? `user=${encodeURIComponent(credentials.user)}` : "",
			credentials.password
				? `password=${encodeURIComponent(credentials.password)}`
				: "",
		].filter(Boolean);
		const query = params.length > 0 ? `?${params.join("&")}` : "";
		return `jdbc:${jdbcDriver(engine)}://${host}${path}${query}`;
	}

	return `${credentials.scheme}://${authorityFor(credentials, host)}${path}`;
}

function varRows(
	engine: LinkEngine,
	target: LinkTargetService,
	prefix: string,
): ParsedEnvVar[] {
	const credentials = credentialsFor(engine, target);
	const rows: ParsedEnvVar[] = [
		{ key: `${prefix}_HOST`, value: target.slug },
		{
			key: `${prefix}_PORT`,
			value: String(target.containerPort || engine.defaultPort),
		},
	];
	if (credentials.user) {
		rows.push({ key: `${prefix}_USER`, value: credentials.user });
	}
	if (credentials.password) {
		rows.push({ key: `${prefix}_PASSWORD`, value: credentials.password });
	}
	if (credentials.database) {
		rows.push({ key: `${prefix}_DB`, value: credentials.database });
	}
	return rows;
}

export function buildLinkEnv(params: BuildLinkEnvParams): ParsedEnvVar[] {
	const engine = detectLinkEngine(params.target.image);
	if (params.format === "vars") {
		return varRows(engine, params.target, params.prefix);
	}
	return [
		{
			key: params.urlKey,
			value: buildLinkUrl(engine, params.target, params.format),
		},
	];
}
