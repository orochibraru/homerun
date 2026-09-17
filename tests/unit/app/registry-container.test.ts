import { describe, expect, test } from "bun:test";
import {
	registryEnv,
	registryLabels,
	registryMatches,
} from "$lib/services/docker/registry-container";

describe("registryEnv", () => {
	test("deletes are always on, auth only when asked for", () => {
		const anonymous = registryEnv({ authEnabled: false, publicHost: null });
		expect(anonymous).toContain("REGISTRY_STORAGE_DELETE_ENABLED=true");
		expect(anonymous.some((entry) => entry.startsWith("REGISTRY_AUTH="))).toBe(
			false,
		);

		const authed = registryEnv({ authEnabled: true, publicHost: null });
		expect(authed).toContain("REGISTRY_AUTH=htpasswd");
		expect(authed).toContain("REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd");
	});
});

describe("registryLabels", () => {
	test("an internal registry gets no Traefik router at all", () => {
		const labels = registryLabels({ authEnabled: true, publicHost: null });
		expect(labels["homerun.infra"]).toBe("mirror");
		expect(Object.keys(labels).some((key) => key.startsWith("traefik."))).toBe(
			false,
		);
	});

	test("a published registry routes its hostname to the registry port", () => {
		const labels = registryLabels({
			authEnabled: true,
			publicHost: "registry.example.com",
		});
		expect(labels["traefik.enable"]).toBe("true");
		expect(labels["traefik.http.routers.homerun-registry.rule"]).toBe(
			"Host(`registry.example.com`)",
		);
		expect(
			labels["traefik.http.services.homerun-registry.loadbalancer.server.port"],
		).toBe("5000");
	});
});

describe("registryMatches", () => {
	const internal = { authEnabled: false, publicHost: null };
	const authed = { authEnabled: true, publicHost: null };

	test("a container already in the wanted shape is left alone", () => {
		expect(
			registryMatches(
				registryEnv(internal),
				registryLabels(internal),
				internal,
			),
		).toBe(true);
		expect(
			registryMatches(registryEnv(authed), registryLabels(authed), authed),
		).toBe(true);
	});

	test("turning auth on or off is a mismatch, so the container gets recreated", () => {
		expect(
			registryMatches(registryEnv(internal), registryLabels(internal), authed),
		).toBe(false);
		// The one that would silently leave a registry demanding credentials
		// nobody has: auth env still present after auth was turned off.
		expect(
			registryMatches(registryEnv(authed), registryLabels(authed), internal),
		).toBe(false);
	});

	test("changing the published hostname is a mismatch", () => {
		const published = {
			authEnabled: true,
			publicHost: "registry.example.com",
		};
		const moved = { authEnabled: true, publicHost: "reg.example.com" };
		expect(
			registryMatches(registryEnv(published), registryLabels(published), moved),
		).toBe(false);
		expect(
			registryMatches(
				registryEnv(published),
				registryLabels(published),
				authed,
			),
		).toBe(false);
	});

	test("unrelated env and labels Docker adds don't force a recreate", () => {
		expect(
			registryMatches(
				[...registryEnv(authed), "PATH=/usr/local/bin", "HOME=/root"],
				{ ...registryLabels(authed), "org.opencontainers.version": "2" },
				authed,
			),
		).toBe(true);
	});
});
