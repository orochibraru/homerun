import { describe, expect, mock, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { GARAGE_ROUTER, garageEnv, garageLabels, garageMatches, garageToml } =
	await import("../../../src/lib/services/docker/garage-container");

const state = { adminToken: "admin", publicHost: null, rpcSecret: "rpc" };

describe("garageToml", () => {
	test("is a single sqlite node with no secret in it", () => {
		const toml = garageToml();
		expect(toml).toContain("replication_factor = 1");
		expect(toml).toContain('db_engine = "sqlite"');
		expect(toml).toContain('s3_region = "garage"');
		expect(toml).not.toContain("rpc_secret");
		expect(toml).not.toContain("admin_token");
	});
});

describe("garageEnv", () => {
	test("hands the secrets over as environment variables", () => {
		expect(garageEnv(state)).toEqual([
			"GARAGE_RPC_SECRET=rpc",
			"GARAGE_ADMIN_TOKEN=admin",
		]);
	});
});

describe("garageLabels", () => {
	test("internal only: just the infra marker", () => {
		expect(garageLabels(state)).toEqual({ "homerun.infra": "garage" });
	});

	test("published: a TLS router to the S3 port only", () => {
		const labels = garageLabels({ ...state, publicHost: "s3.example.com" });
		expect(labels[`traefik.http.routers.${GARAGE_ROUTER}.rule`]).toBe(
			"Host(`s3.example.com`)",
		);
		expect(
			labels[`traefik.http.services.${GARAGE_ROUTER}.loadbalancer.server.port`],
		).toBe("3900");
		expect(labels[`traefik.http.routers.${GARAGE_ROUTER}.tls`]).toBe("true");
	});
});

describe("garageMatches", () => {
	test("matches when the secrets and Traefik labels are the wanted ones", () => {
		expect(
			garageMatches(
				[...garageEnv(state), "PATH=/bin"],
				{ ...garageLabels(state), "com.docker.x": "y" },
				state,
			),
		).toBe(true);
	});

	test("a rotated secret or a host change means recreating it", () => {
		expect(
			garageMatches(garageEnv(state), garageLabels(state), {
				...state,
				adminToken: "new",
			}),
		).toBe(false);
		expect(
			garageMatches(garageEnv(state), garageLabels(state), {
				...state,
				publicHost: "s3.example.com",
			}),
		).toBe(false);
	});
});
