import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { hasTraefikRouterFor } = await import(
	"../../../src/lib/services/docker/labels"
);

const ROUTED = {
	"traefik.enable": "true",
	"traefik.http.routers.homerun.rule": "Host(`dash.example.com`)",
	"traefik.http.services.homerun.loadbalancer.server.port": "3000",
};

describe("hasTraefikRouterFor", () => {
	test("finds the router that publishes a host", () => {
		expect(hasTraefikRouterFor(ROUTED, "dash.example.com")).toBe(true);
	});

	test("a container with no labels at all isn't routed", () => {
		expect(hasTraefikRouterFor({}, "dash.example.com")).toBe(false);
	});

	test("a rule for a different host doesn't count", () => {
		expect(hasTraefikRouterFor(ROUTED, "other.example.com")).toBe(false);
	});

	test("a rule Traefik is told to ignore doesn't count either", () => {
		expect(
			hasTraefikRouterFor(
				{ ...ROUTED, "traefik.enable": "false" },
				"dash.example.com",
			),
		).toBe(false);
	});
});
