import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const settings = {
	decryptPangolinApiToken: () => "good-token",
	pangolinApiBaseUrl: "https://api.pangolin.test/v1",
	pangolinConfigured: true,
	pangolinMainSiteName: "site-23",
	pangolinOrgId: "org-1",
	pangolinOwnsAuth: false,
	pangolinTargetHost: "localhost" as string | null,
	pangolinTargetPort: 443,
};

let detectedTargetHost = "homerun-traefik-1";

const { DockerService } = await import(
	"../../../src/lib/services/docker.service"
);
const { InstanceSettingsDTO } = await import(
	"../../../src/lib/dto/instance-settings-dto"
);

const { PangolinService } = await import(
	"../../../src/lib/services/pangolin.service"
);
const { matchPangolinDomain, targetScheme } = await import(
	"../../../src/lib/services/pangolin/domains"
);

const BASE_URL = "https://api.pangolin.test/v1";

const SITES = Array.from({ length: 25 }, (_, i) => ({
	name: `site-${i + 1}`,
	siteId: i + 1,
}));
const DOMAINS = [
	{ baseDomain: "example.com", domainId: "dom-1", type: "ns", verified: true },
	{ baseDomain: "other.test", domainId: "dom-2", type: "ns", verified: true },
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

interface StubResource {
	enabled?: boolean;
	fullDomain: string;
	mode?: string;
	name: string;
	resourceId: number;
	sso?: boolean | number;
}

interface StubWrite {
	body: Record<string, unknown>;
	method: string;
	path: string;
}

interface StubTarget {
	enabled?: boolean;
	ip: string;
	method?: string;
	port: number;
	siteId?: number;
	targetId: number;
}

let resources: StubResource[] = [];
let targets: StubTarget[] = [];
let writes: StubWrite[] = [];
let ssoUpdateStatus = 200;
let deleteStatus = 200;
let totalAsString = false;
let raceOnCreate = false;

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
			pagination: {
				total: totalAsString ? String(rows.length) : rows.length,
			},
		},
		error: false,
		message: "retrieved successfully",
		status: 200,
		success: true,
	});
}

beforeEach(() => {
	stub(DockerService, "tunnelTargetHost", async () => detectedTargetHost);
	stub(InstanceSettingsDTO, "get", async () => settings);
	settings.pangolinOwnsAuth = false;
	settings.pangolinTargetHost = "localhost";
	detectedTargetHost = "homerun-traefik-1";
	requested = [];
	resources = [];
	targets = [{ ip: "localhost", port: 443, targetId: 5 }];
	writes = [];
	ssoUpdateStatus = 200;
	deleteStatus = 200;
	totalAsString = false;
	raceOnCreate = false;
	respondWithDashboardHtml = false;
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const href = typeof input === "string" ? input : input.toString();
		requested.push(href);
		const url = new URL(href);
		const method = init?.method ?? "GET";
		const body =
			typeof init?.body === "string"
				? (JSON.parse(init.body) as Record<string, unknown>)
				: {};
		if (method !== "GET") {
			writes.push({ body, method, path: url.pathname });
		}
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
		if (url.pathname === "/v1/org/org-1") {
			return json({ data: { orgId: "org-1" }, success: true });
		}
		if (url.pathname === "/v1/org/org-1/sites") {
			return pageOf(SITES, url, "sites");
		}
		if (url.pathname === "/v1/org/org-1/domains") {
			return pageOf(DOMAINS, url, "domains");
		}
		if (url.pathname === "/v1/org/org-1/resources") {
			return pageOf(resources, url, "resources");
		}
		if (url.pathname === "/v1/org/org-1/resource" && method === "PUT") {
			const created = {
				fullDomain: body.subdomain
					? `${body.subdomain as string}.example.com`
					: "example.com",
				name: body.name as string,
				resourceId: 99,
			};
			resources.push(raceOnCreate ? { ...created, resourceId: 42 } : created);
			return raceOnCreate
				? json(
						{
							data: null,
							error: true,
							message: "Resource with that domain already exists",
							status: 409,
							success: false,
						},
						409,
					)
				: json({ data: created, success: true });
		}
		if (/^\/v1\/resource\/\d+$/.test(url.pathname) && method === "DELETE") {
			return deleteStatus === 200
				? json({ data: null, success: true })
				: json(
						{ data: null, message: "Resource not found", success: false },
						deleteStatus,
					);
		}
		if (/^\/v1\/resource\/\d+$/.test(url.pathname) && method === "POST") {
			return ssoUpdateStatus === 200
				? json({ data: {}, success: true })
				: json(
						{ data: null, message: "resource update failed", success: false },
						ssoUpdateStatus,
					);
		}
		if (/^\/v1\/resource\/\d+\/targets$/.test(url.pathname)) {
			return pageOf(targets, url, "targets");
		}
		if (/^\/v1\/target\/\d+$/.test(url.pathname) && method === "POST") {
			return json({ data: {}, success: true });
		}
		if (/^\/v1\/resource\/\d+\/target$/.test(url.pathname)) {
			return json({ data: { targetId: 1 }, success: true });
		}
		return json({ data: null, message: "not found", success: false }, 404);
	}) as typeof fetch;
});

afterEach(() => {
	restoreStubs();
	globalThis.fetch = realFetch;
});

describe("targetScheme", () => {
	test("443 and anything else Traefik serves is https, only 80 is http", () => {
		expect(targetScheme(443)).toBe("https");
		expect(targetScheme(8443)).toBe("https");
		expect(targetScheme(80)).toBe("http");
	});
});

describe("PangolinService.syncDnsRecord", () => {
	test("turns Pangolin's own SSO gate off on a resource it creates", async () => {
		const result = await PangolinService.syncDnsRecord("app.example.com");

		expect(result).toEqual({
			detail: "created app.example.com -> https://localhost:443 via site-23",
			ok: true,
			provider: "pangolin",
		});
		expect(writes).toContainEqual({
			body: { sso: false },
			method: "POST",
			path: "/v1/resource/99",
		});
	});

	test("turns it off on a resource that already exists, so a redeploy heals one created before this", async () => {
		resources = [{ fullDomain: "app.example.com", name: "app", resourceId: 7 }];

		const result = await PangolinService.syncDnsRecord("app.example.com");

		expect(result?.ok).toBe(true);
		expect(result?.detail).toContain("Pangolin SSO off");
		expect(result?.detail).toContain("target https://localhost:443");
		expect(writes).toEqual([
			{ body: { sso: false }, method: "POST", path: "/v1/resource/7" },
		]);
	});

	test("leaves Pangolin's SSO on when Pangolin is the one that owns sign-in", async () => {
		settings.pangolinOwnsAuth = true;

		const result = await PangolinService.syncDnsRecord("app.example.com");

		expect(result?.ok).toBe(true);
		expect(writes).toContainEqual({
			body: { sso: true },
			method: "POST",
			path: "/v1/resource/99",
		});
	});

	test("points the target at the configured host, not always localhost", async () => {
		settings.pangolinTargetHost = "192.168.1.50";

		const result = await PangolinService.syncDnsRecord("app.example.com");

		expect(result?.detail).toContain("https://192.168.1.50:443");
		expect(writes).toContainEqual({
			body: {
				enabled: true,
				ip: "192.168.1.50",
				method: "https",
				port: 443,
				siteId: 23,
			},
			method: "PUT",
			path: "/v1/resource/99/target",
		});
	});

	test("detects the target host when none is configured", async () => {
		settings.pangolinTargetHost = null;

		const result = await PangolinService.syncDnsRecord("app.example.com");

		expect(result?.detail).toContain("https://homerun-traefik-1:443");
		expect(writes).toContainEqual({
			body: {
				enabled: true,
				ip: "homerun-traefik-1",
				method: "https",
				port: 443,
				siteId: 23,
			},
			method: "PUT",
			path: "/v1/resource/99/target",
		});
	});

	test("moves an existing resource's stale target, so a redeploy heals a 502", async () => {
		settings.pangolinTargetHost = null;
		resources = [{ fullDomain: "app.example.com", name: "app", resourceId: 7 }];

		const result = await PangolinService.syncDnsRecord("app.example.com");

		expect(result?.ok).toBe(true);
		expect(result?.detail).toContain(
			"target moved from localhost:443 to https://homerun-traefik-1:443",
		);
		expect(writes).toContainEqual({
			body: {
				enabled: true,
				ip: "homerun-traefik-1",
				method: "https",
				port: 443,
				siteId: 23,
			},
			method: "POST",
			path: "/v1/target/5",
		});
	});

	test("adds a target to an existing resource that has none", async () => {
		resources = [{ fullDomain: "app.example.com", name: "app", resourceId: 7 }];
		targets = [];

		const result = await PangolinService.syncDnsRecord("app.example.com");

		expect(result?.detail).toContain("target https://localhost:443 added");
		expect(writes.map((write) => write.path)).toContain(
			"/v1/resource/7/target",
		);
	});

	test("lets the caller force SSO off regardless of the instance setting", async () => {
		settings.pangolinOwnsAuth = true;

		await PangolinService.syncDnsRecord("dash.example.com", { sso: false });

		expect(writes).toContainEqual({
			body: { sso: false },
			method: "POST",
			path: "/v1/resource/99",
		});
	});

	test("reports a failed SSO update instead of leaving a gated route looking fine", async () => {
		ssoUpdateStatus = 500;

		const result = await PangolinService.syncDnsRecord("app.example.com");

		expect(result?.ok).toBe(false);
		expect(result?.detail).toContain("resource update failed");
	});
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
		const sitesCall = requested.find((href) => href.includes("/sites"));
		expect(sitesCall).toContain("page=1");
		expect(sitesCall).toContain("pageSize=1000");
	});

	test("pages the domains endpoint by offset, not by page number", async () => {
		await PangolinService.verifyConnection({
			baseUrl: BASE_URL,
			orgId: "org-1",
			token: "good-token",
		});
		const domainCall = requested.find((href) => href.includes("/domains"));
		expect(domainCall).toContain("offset=0");
		expect(domainCall).toContain("limit=1000");
	});

	test("tolerates a trailing slash on the base URL", async () => {
		const result = await PangolinService.verifyConnection({
			baseUrl: `${BASE_URL}/`,
			orgId: "org-1",
			token: "good-token",
		});
		expect(result.success).toBe(true);
		expect(requested[0]).toEndWith("/v1/org/org-1");
		expect(requested[1]).toContain("/v1/org/org-1/sites?");
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

	test("names a missing org instead of reporting empty lists", async () => {
		const result = await PangolinService.verifyConnection({
			baseDomain: "app.example.com",
			baseUrl: BASE_URL,
			orgId: "typo",
			token: "good-token",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain('Organization "typo" doesn\'t exist');
		expect(requested.some((href) => href.includes("/sites"))).toBe(false);
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

describe("matchPangolinDomain", () => {
	test("prefers the most specific registered domain", () => {
		const match = matchPangolinDomain("app.apps.example.com", [
			{ baseDomain: "example.com", domainId: "wide", type: "ns" },
			{ baseDomain: "apps.example.com", domainId: "narrow", type: "wildcard" },
		]);
		expect(match?.domain.domainId).toBe("narrow");
		expect(match?.subdomain).toBe("app");
	});

	test("a CNAME-type domain only routes its own exact name", () => {
		const domains = [
			{ baseDomain: "app.example.com", domainId: "cname", type: "cname" },
		];
		expect(matchPangolinDomain("x.app.example.com", domains)).toBeNull();
		expect(
			matchPangolinDomain("app.example.com", domains)?.subdomain,
		).toBeNull();
	});

	test("sends a null subdomain for the apex and compares case-insensitively", () => {
		const match = matchPangolinDomain("Example.COM", DOMAINS);
		expect(match?.domain.domainId).toBe("dom-1");
		expect(match?.subdomain).toBeNull();
	});
});

describe("PangolinService idempotency", () => {
	test("creates an apex resource with a null subdomain, since a wildcard domain turns an empty one into .example.com", async () => {
		const result = await PangolinService.syncDnsRecord("example.com");

		expect(result?.ok).toBe(true);
		expect(writes).toContainEqual({
			body: {
				domainId: "dom-1",
				http: true,
				name: "example.com",
				postAuthPath: "/",
				protocol: "tcp",
				stickySession: true,
				subdomain: null,
			},
			method: "PUT",
			path: "/v1/org/org-1/resource",
		});
	});

	test("finds an existing resource regardless of hostname case, and skips an SSO write that changes nothing", async () => {
		resources = [
			{ fullDomain: "app.example.com", name: "app", resourceId: 7, sso: 0 },
		];

		const result = await PangolinService.syncDnsRecord("App.Example.com");

		expect(result?.ok).toBe(true);
		expect(writes).toEqual([]);
	});

	test("ignores an inference resource sharing the hostname", async () => {
		resources = [
			{
				fullDomain: "app.example.com",
				mode: "inference",
				name: "ai",
				resourceId: 7,
			},
		];

		const result = await PangolinService.syncDnsRecord("app.example.com");

		expect(result?.detail).toStartWith("created app.example.com");
	});

	test("heals the winner when a concurrent sync created the resource first (409)", async () => {
		raceOnCreate = true;

		const result = await PangolinService.syncDnsRecord("app.example.com");

		expect(result?.ok).toBe(true);
		expect(result?.detail).toContain("was created concurrently");
		expect(writes).toContainEqual({
			body: { sso: false },
			method: "POST",
			path: "/v1/resource/42",
		});
	});

	test("repairs a target on the right address with the wrong scheme, site or enabled flag instead of adding another", async () => {
		resources = [{ fullDomain: "app.example.com", name: "app", resourceId: 7 }];
		targets = [
			{
				enabled: false,
				ip: "localhost",
				method: "http",
				port: 443,
				siteId: 1,
				targetId: 5,
			},
		];

		const result = await PangolinService.syncDnsRecord("app.example.com");

		expect(result?.detail).toContain("target https://localhost:443 repaired");
		expect(writes).toContainEqual({
			body: {
				enabled: true,
				ip: "localhost",
				method: "https",
				port: 443,
				siteId: 23,
			},
			method: "POST",
			path: "/v1/target/5",
		});
		expect(writes.map((write) => write.path)).not.toContain(
			"/v1/resource/7/target",
		);
	});

	test("reports an unverified domain instead of letting Pangolin 400", async () => {
		const unverified = DOMAINS.map((domain) => ({
			...domain,
			verified: false,
		}));
		const original = DOMAINS.splice(0, DOMAINS.length, ...unverified);

		const result = await PangolinService.syncDnsRecord("app.example.com");
		DOMAINS.splice(0, DOMAINS.length, ...original);

		expect(result?.ok).toBe(false);
		expect(result?.detail).toContain("isn't verified");
		expect(writes).toEqual([]);
	});

	test("follows pagination when Postgres reports the total as a string", async () => {
		totalAsString = true;

		const result = await PangolinService.verifyConnection({
			baseUrl: BASE_URL,
			orgId: "org-1",
			siteName: "site-23",
			token: "good-token",
		});

		expect(result.success).toBe(true);
		expect(result.detail).toContain("25 site(s)");
	});
});

describe("PangolinService.deleteDnsRecord", () => {
	test("deletes the matching resource", async () => {
		resources = [{ fullDomain: "app.example.com", name: "app", resourceId: 7 }];

		const result = await PangolinService.deleteDnsRecord("app.example.com");

		expect(result).toEqual({
			detail: "removed app.example.com",
			ok: true,
			provider: "pangolin",
		});
		expect(writes).toEqual([
			{ body: {}, method: "DELETE", path: "/v1/resource/7" },
		]);
	});

	test("treats a resource deleted out of band between lookup and delete as gone", async () => {
		resources = [{ fullDomain: "app.example.com", name: "app", resourceId: 7 }];
		deleteStatus = 404;

		const result = await PangolinService.deleteDnsRecord("app.example.com");

		expect(result?.ok).toBe(true);
	});

	test("reports success with nothing to do when no resource exists", async () => {
		const result = await PangolinService.deleteDnsRecord("app.example.com");

		expect(result?.detail).toBe("no resource for app.example.com");
		expect(writes).toEqual([]);
	});
});
