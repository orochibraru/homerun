import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../../src/lib/config";
import {
	browserOrigin,
	dashboardOrigin,
	offCanonicalOrigin,
	withDashboardOrigin,
} from "../../../src/lib/server/canonical-origin";

const originalOrigin = config.auth.origin;

afterEach(() => {
	config.auth.origin = originalOrigin;
});

function requestTo(href: string, headers: Record<string, string> = {}) {
	const request = { headers: new Headers(headers) } as Request;
	return { request, url: new URL(href) };
}

describe("browserOrigin", () => {
	test("prefers the proxy's forwarded host and proto", () => {
		const { request, url } = requestTo("http://10.0.0.5:3000/x", {
			host: "10.0.0.5:3000",
			"x-forwarded-host": "homerun.example.com",
			"x-forwarded-proto": "https",
		});
		expect(browserOrigin(request, url)).toBe("https://homerun.example.com");
	});

	test("uses the Host header with the URL's own scheme", () => {
		const { request, url } = requestTo("http://10.0.0.5:3000/x", {
			host: "box.lan:8080",
		});
		expect(browserOrigin(request, url)).toBe("http://box.lan:8080");
	});

	test("falls back to the URL when there's no host header at all", () => {
		const { request, url } = requestTo("https://a.test:9/p");
		expect(browserOrigin(request, url)).toBe("https://a.test:9");
	});
});

describe("offCanonicalOrigin", () => {
	const { request, url } = requestTo("http://10.0.0.5:3000/auth/sign-in", {
		host: "10.0.0.5:3000",
	});

	test("is null when no dashboard URL is configured or it can't be parsed", () => {
		config.auth.origin = undefined;
		expect(offCanonicalOrigin(request, url)).toBeNull();
		config.auth.origin = "not a url";
		expect(offCanonicalOrigin(request, url)).toBeNull();
	});

	test("points at the configured origin from anywhere else", () => {
		config.auth.origin = "https://homerun.example.com/dash";
		expect(offCanonicalOrigin(request, url)).toBe(
			"https://homerun.example.com",
		);
	});

	test("is null when already on it", () => {
		config.auth.origin = "http://10.0.0.5:3000";
		expect(offCanonicalOrigin(request, url)).toBeNull();
	});
});

describe("dashboardOrigin", () => {
	test("uses the configured origin, else the browser's", () => {
		const { request, url } = requestTo("http://10.0.0.5:3000/", {
			host: "10.0.0.5:3000",
		});
		config.auth.origin = "https://homerun.example.com/";
		expect(dashboardOrigin(request, url)).toBe("https://homerun.example.com");
		config.auth.origin = "::bad";
		expect(dashboardOrigin(request, url)).toBe("http://10.0.0.5:3000");
		config.auth.origin = undefined;
		expect(dashboardOrigin(request, url)).toBe("http://10.0.0.5:3000");
	});
});

describe("withDashboardOrigin", () => {
	const link = "http://10.0.0.5:3000/auth/reset?token=abc#top";

	test("moves a link onto the dashboard origin, keeping path, query and hash", () => {
		config.auth.origin = "https://homerun.example.com";
		expect(withDashboardOrigin(link)).toBe(
			"https://homerun.example.com/auth/reset?token=abc#top",
		);
	});

	test("leaves the link alone without a usable dashboard URL or link", () => {
		config.auth.origin = undefined;
		expect(withDashboardOrigin(link)).toBe(link);
		config.auth.origin = "https://homerun.example.com";
		expect(withDashboardOrigin("/relative")).toBe("/relative");
	});
});
