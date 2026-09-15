import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { dashboardHostFrom, dashboardRouterConfig } = await import(
	"../../../src/lib/services/docker/dashboard"
);

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

	test("asks for no certificate when the dashboard is an IP, since ACME can't issue for one", () => {
		const yaml = dashboardRouterConfig({ ...params, host: "203.0.113.10" });
		expect(yaml).toContain("tls: {}");
		expect(yaml).not.toContain("certResolver");
	});
});
