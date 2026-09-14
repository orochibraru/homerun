import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { PangolinService } = await import(
	"../../../src/lib/services/pangolin.service"
);

const BASE_URL = "https://api.pangolin.test/v1";

const SITES = Array.from({ length: 25 }, (_, i) => ({
	name: `site-${i + 1}`,
	siteId: i + 1,
}));
const DOMAINS = [
	{ baseDomain: "example.com", domainId: "dom-1" },
	{ baseDomain: "other.test", domainId: "dom-2" },
];

// Every page is capped at 10 rows no matter what `pageSize` asks for, exactly
// as a real server with its own maximum would: the site these tests look for
// sits on the third page, so a client that reads page one and stops can't find
// it. That's the bug this stub exists to catch, the previous version of this
// client inherited Pangolin's 20-per-page default and never paged at all.
const PAGE = 10;

const realFetch = globalThis.fetch;
let requested: string[] = [];
let respondWithDashboardHtml = false;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function pageOf<T>(rows: T[], url: URL, field: string): Response {
	const start = url.searchParams.has("offset")
		? Number(url.searchParams.get("offset"))
		: (Number(url.searchParams.get("page") ?? "1") - 1) * PAGE;
	return json({
		data: {
			[field]: rows.slice(start, start + PAGE),
			pagination: { total: rows.length },
		},
		success: true,
	});
}

beforeEach(() => {
	requested = [];
	respondWithDashboardHtml = false;
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const href = typeof input === "string" ? input : input.toString();
		requested.push(href);
		const url = new URL(href);
		const auth = new Headers(init?.headers).get("authorization");
		if (auth !== "Bearer good-token") {
			return json(
				{ data: null, message: "API key required", success: false },
				401,
			);
		}
		if (respondWithDashboardHtml) {
			return new Response("<!doctype html><html>dashboard</html>", {
				headers: { "content-type": "text/html" },
			});
		}
		if (url.pathname === "/v1/org/org-1/sites") {
			return pageOf(SITES, url, "sites");
		}
		if (url.pathname === "/v1/org/org-1/domains") {
			return pageOf(DOMAINS, url, "domains");
		}
		return json({ data: null, message: "not found", success: false }, 404);
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("PangolinService.verifyConnection", () => {
	test("pages past the first page to find a site and a covering domain", async () => {
		const result = await PangolinService.verifyConnection({
			baseDomain: "app.example.com",
			baseUrl: BASE_URL,
			orgId: "org-1",
			siteName: "site-23",
			token: "good-token",
		});
		expect(result.success).toBe(true);
		expect(result.detail).toContain("25 site(s)");
		expect(result.detail).toContain('site "site-23" found');
		expect(result.detail).toContain("app.example.com routes under example.com");
		expect(requested.filter((href) => href.includes("/sites"))).toHaveLength(3);
		expect(requested[0]).toContain("page=1");
		expect(requested[0]).toContain("pageSize=1000");
	});

	test("pages the domains endpoint by offset, not by page number", async () => {
		await PangolinService.verifyConnection({
			baseUrl: BASE_URL,
			orgId: "org-1",
			token: "good-token",
		});
		const domainCalls = requested.filter((href) => href.includes("/domains"));
		expect(domainCalls[0]).toContain("offset=0");
		expect(domainCalls[0]).toContain("limit=1000");
	});

	test("tolerates a trailing slash on the base URL", async () => {
		const result = await PangolinService.verifyConnection({
			baseUrl: `${BASE_URL}/`,
			orgId: "org-1",
			token: "good-token",
		});
		expect(result.success).toBe(true);
		expect(requested[0]).toContain("/v1/org/org-1/sites?");
	});

	test("fails on a site name that doesn't exist, and says what does", async () => {
		const result = await PangolinService.verifyConnection({
			baseUrl: BASE_URL,
			orgId: "org-1",
			siteName: "typo",
			token: "good-token",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain('Site "typo" doesn\'t exist');
		expect(result.error).toContain("site-1");
	});

	test("fails when no registered domain covers the base domain", async () => {
		const result = await PangolinService.verifyConnection({
			baseDomain: "app.elsewhere.net",
			baseUrl: BASE_URL,
			orgId: "org-1",
			siteName: "site-1",
			token: "good-token",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("No registered Pangolin domain covers");
		expect(result.error).toContain("example.com, other.test");
	});

	test("surfaces the API's own message on a bad token", async () => {
		const result = await PangolinService.verifyConnection({
			baseUrl: BASE_URL,
			orgId: "org-1",
			token: "wrong",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("401");
		expect(result.error).toContain("API key required");
	});

	test("names the likely cause when pointed at a dashboard instead of the API", async () => {
		respondWithDashboardHtml = true;
		const result = await PangolinService.verifyConnection({
			baseUrl: BASE_URL,
			orgId: "org-1",
			token: "good-token",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("HTML, not JSON");
	});
});
