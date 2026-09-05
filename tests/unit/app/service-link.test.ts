import { describe, expect, test } from "bun:test";
import {
	buildLinkEnv,
	defaultUrlKey,
	defaultVarPrefix,
	detectLinkEngine,
} from "../../../src/lib/service-link";

const postgres = {
	containerPort: 5432,
	envVars: {
		POSTGRES_DB: "app",
		POSTGRES_PASSWORD: "s3cr et",
		POSTGRES_USER: "app",
	},
	image: "postgres",
	name: "Postgres",
	slug: "db",
};

const redis = {
	containerPort: 6379,
	envVars: { REDIS_PASSWORD: "hunter2" },
	image: "redis:7-alpine",
	name: "Redis",
	slug: "cache",
};

const other = {
	containerPort: 3000,
	envVars: {},
	image: "ghcr.io/acme/api",
	name: "API",
	slug: "acme-api",
};

describe("detectLinkEngine", () => {
	test("recognises the common data stores", () => {
		expect(detectLinkEngine("postgres:17").id).toBe("postgres");
		expect(detectLinkEngine("timescale/timescaledb:latest-pg16").id).toBe(
			"postgres",
		);
		expect(detectLinkEngine("mariadb").id).toBe("mariadb");
		expect(detectLinkEngine("mysql:8").id).toBe("mysql");
		expect(detectLinkEngine("valkey/valkey").id).toBe("redis");
		expect(detectLinkEngine("mongo:7").id).toBe("mongo");
		expect(detectLinkEngine("rabbitmq:4-management").id).toBe("rabbitmq");
	});

	test("falls back to a generic HTTP service", () => {
		expect(detectLinkEngine("ghcr.io/acme/api").id).toBe("generic");
	});
});

describe("buildLinkEnv", () => {
	test("builds a connection URL against the internal hostname", () => {
		const engine = detectLinkEngine(postgres.image);
		expect(
			buildLinkEnv({
				format: "url",
				prefix: defaultVarPrefix(engine, postgres),
				target: postgres,
				urlKey: defaultUrlKey(engine, postgres),
			}),
		).toEqual([
			{ key: "POSTGRES_URL", value: "postgres://app:s3cr%20et@db:5432/app" },
		]);
	});

	test("builds a JDBC URL with credentials as query params", () => {
		expect(
			buildLinkEnv({
				format: "jdbc",
				prefix: "POSTGRES",
				target: postgres,
				urlKey: "DB_URL",
			}),
		).toEqual([
			{
				key: "DB_URL",
				value: "jdbc:postgresql://db:5432/app?user=app&password=s3cr%20et",
			},
		]);
	});

	test("builds one variable per value under a caller-chosen prefix", () => {
		expect(
			buildLinkEnv({
				format: "vars",
				prefix: "DB",
				target: postgres,
				urlKey: "",
			}),
		).toEqual([
			{ key: "DB_HOST", value: "db" },
			{ key: "DB_PORT", value: "5432" },
			{ key: "DB_USER", value: "app" },
			{ key: "DB_PASSWORD", value: "s3cr et" },
			{ key: "DB_DB", value: "app" },
		]);
	});

	test("omits an absent user from a redis URL", () => {
		expect(
			buildLinkEnv({
				format: "url",
				prefix: "REDIS",
				target: redis,
				urlKey: "REDIS_URL",
			}),
		).toEqual([{ key: "REDIS_URL", value: "redis://:hunter2@cache:6379" }]);
	});

	test("names a generic service's variables after its slug", () => {
		const engine = detectLinkEngine(other.image);
		expect(defaultUrlKey(engine, other)).toBe("ACME_API_URL");
		expect(
			buildLinkEnv({
				format: "url",
				prefix: defaultVarPrefix(engine, other),
				target: other,
				urlKey: defaultUrlKey(engine, other),
			}),
		).toEqual([{ key: "ACME_API_URL", value: "http://acme-api:3000" }]);
	});
});
