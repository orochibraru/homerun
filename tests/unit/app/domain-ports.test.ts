import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { buildContainerLabels } = await import(
	"../../../src/lib/services/docker/labels"
);

describe("per-domain container ports", () => {
	const labels = buildContainerLabels({
		containerPort: 3000,
		domainPorts: { "api.example.org": 8080 },
		domains: ["git.example.org", "api.example.org"],
		serviceId: "svc-1",
		slug: "gitea",
	});

	test("a domain without an override stays on the containerPort service", () => {
		expect(labels["traefik.http.routers.gitea-1.service"]).toBe("gitea");
		expect(labels["traefik.http.services.gitea.loadbalancer.server.port"]).toBe(
			"3000",
		);
	});

	test("an overridden domain gets its own service on its port", () => {
		expect(labels["traefik.http.routers.gitea-2.rule"]).toBe(
			"Host(`api.example.org`)",
		);
		expect(labels["traefik.http.routers.gitea-2.service"]).toBe("gitea-8080");
		expect(
			labels["traefik.http.services.gitea-8080.loadbalancer.server.port"],
		).toBe("8080");
	});
});
