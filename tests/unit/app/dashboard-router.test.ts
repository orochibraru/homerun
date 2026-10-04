import { describe, expect, mock, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const {
	DASHBOARD_ROUTER_PRIORITY,
	dashboardHostFrom,
	dashboardRouterConfig,
	dashboardRouterPlan,
} = await import("../../../src/lib/services/docker/dashboard");

describe("dashboardHostFrom", () => {
	test("takes the host out of a Dashboard URL", () => {
		expect(dashboardHostFrom("https://dash.example.com")).toBe(
			"dash.example.com",
		);
		expect(dashboardHostFrom("http://dash.example.com/")).toBe(
			"dash.example.com",
		);
	});

	test("skips an origin with an explicit port : that instance is reached directly, not through Traefik", () => {
		expect(dashboardHostFrom("http://203.0.113.10:3000")).toBeNull();
		expect(dashboardHostFrom("http://localhost:5173")).toBeNull();
	});

	test("skips an unset or unparseable origin", () => {
		expect(dashboardHostFrom(null)).toBeNull();
		expect(dashboardHostFrom("not a url")).toBeNull();
	});
});

describe("dashboardRouterConfig", () => {
	const params = {
		certResolver: "letsencrypt",
		entrypoint: "websecure",
		host: "dash.example.com",
		target: "http://homerun-app-1:3000",
	};

	test("routes the host to this app's own container", () => {
		const yaml = dashboardRouterConfig(params);
		expect(yaml).toContain("rule: Host(`dash.example.com`)");
		expect(yaml).toContain("- websecure");
		expect(yaml).toContain("- url: http://homerun-app-1:3000");
		expect(yaml).toContain("certResolver: letsencrypt");
	});

	test("outranks the rule-length priority a label router for the same host gets", () => {
		const yaml = dashboardRouterConfig(params);
		expect(yaml).toContain(`priority: ${DASHBOARD_ROUTER_PRIORITY}`);
		expect(DASHBOARD_ROUTER_PRIORITY).toBeGreaterThan(
			"Host(`a-very-long-dashboard-hostname.example.com`)".length * 10,
		);
	});

	test("asks for no certificate when there's no resolver for that host", () => {
		const yaml = dashboardRouterConfig({
			...params,
			certResolver: null,
			host: "203.0.113.10",
		});
		expect(yaml).toContain("tls: {}");
		expect(yaml).not.toContain("certResolver");
	});
});

describe("dashboardRouterPlan", () => {
	const self = {
		aliases: ["app", "homerun-auth"],
		name: "homerun-app-1",
		networkAddress: "172.20.0.5",
	};

	test("always writes the file route, even when the container's own labels route the host", () => {
		expect(dashboardRouterPlan("dash.example.com", self)).toEqual({
			action: "write",
			target: "homerun-auth",
		});
	});

	test("targets the container's name, then its address, when it lacks the homerun-auth alias", () => {
		expect(
			dashboardRouterPlan("dash.example.com", { ...self, aliases: [] }),
		).toEqual({ action: "write", target: "homerun-app-1" });
		expect(
			dashboardRouterPlan("dash.example.com", {
				...self,
				aliases: [],
				name: null,
			}),
		).toEqual({ action: "write", target: "172.20.0.5" });
	});

	test("removes the route only when there's no host to route", () => {
		expect(dashboardRouterPlan(null, self)).toEqual({ action: "remove" });
	});

	test("leaves a working route alone when this container can't be inspected", () => {
		expect(dashboardRouterPlan("dash.example.com", null)).toEqual({
			action: "keep",
		});
		expect(
			dashboardRouterPlan("dash.example.com", {
				aliases: [],
				name: null,
				networkAddress: null,
			}),
		).toEqual({ action: "keep" });
	});
});
