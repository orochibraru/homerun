import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const settings = {
	cloudflareConfigured: true,
	cloudflareZoneId: "023e105f4ecef8ad9ca31a8372d0c353",
	decryptCloudflareApiToken: () => "good-token",
};

mock.module("$lib/dto/instance-settings-dto", () => ({
	InstanceSettingsDTO: { get: async () => settings },
}));

const {
	CLOUDFLARE_MANAGED_COMMENT,
	CloudflareService,
	formatCloudflareErrors,
	hostnameInZone,
} = await import("../../../src/lib/services/cloudflare.service");

const ZONE_ID = settings.cloudflareZoneId;
const ZONE_PATH = `/client/v4/zones/${ZONE_ID}`;

interface StubRecord {
	comment: string | null;
	content: string;
	id: string;
	name: string;
	proxied: boolean;
	ttl: number;
	type: string;
}

interface StubWrite {
	body: Record<string, unknown>;
	method: string;
	path: string;
}

const realFetch = globalThis.fetch;
let records: StubRecord[] = [];
let writes: StubWrite[] = [];
let requested: string[] = [];
let zoneName = "example.com";
let zoneStatus = "active";
let deleteStatus = 200;
let rateLimited = false;

function envelope(result: unknown, status = 200, extra = {}): Response {
	return new Response(
		JSON.stringify({
			errors: [],
			messages: [],
			result,
			success: true,
			...extra,
		}),
		{ headers: { "content-type": "application/json" }, status },
	);
}

function failure(
	status: number,
	errors: Array<{ code: number; message: string }>,
	headers: Record<string, string> = {},
): Response {
	return new Response(
		JSON.stringify({ errors, messages: [], result: null, success: false }),
		{ headers: { "content-type": "application/json", ...headers }, status },
	);
}

function record(overrides: Partial<StubRecord>): StubRecord {
	return {
		comment: null,
		content: "example.com",
		id: "372e67954025e0ba6aaa6d586b9e0b59",
		name: "app.example.com",
		proxied: false,
		ttl: 1,
		type: "CNAME",
		...overrides,
	};
}

beforeEach(() => {
	settings.cloudflareConfigured = true;
	records = [];
	writes = [];
	requested = [];
	zoneName = "example.com";
	zoneStatus = "active";
	deleteStatus = 200;
	rateLimited = false;
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const href = typeof input === "string" ? input : input.toString();
		requested.push(href);
		const url = new URL(href);
		const method = init?.method ?? "GET";
		if (method !== "GET") {
			writes.push({
				body:
					typeof init?.body === "string"
						? (JSON.parse(init.body) as Record<string, unknown>)
						: {},
				method,
				path: url.pathname,
			});
		}
		if (
			new Headers(init?.headers).get("authorization") !== "Bearer good-token"
		) {
			return failure(401, [{ code: 10_000, message: "Authentication error" }]);
		}
		if (rateLimited) {
			return failure(429, [{ code: 10_000, message: "Rate limited" }], {
				"retry-after": "42",
			});
		}
		if (url.pathname === ZONE_PATH) {
			return envelope({ id: ZONE_ID, name: zoneName, status: zoneStatus });
		}
		if (url.pathname === `${ZONE_PATH}/dns_records` && method === "GET") {
			const name = url.searchParams.get("name.exact");
			const matching = records.filter(
				(candidate) => !name || candidate.name === name.toLowerCase(),
			);
			return envelope(matching, 200, {
				result_info: {
					count: matching.length,
					page: 1,
					per_page: Number(url.searchParams.get("per_page") ?? 100),
					total_count: matching.length,
				},
			});
		}
		if (url.pathname === `${ZONE_PATH}/dns_records` && method === "POST") {
			const hasSameName = records.some(
				(candidate) =>
					candidate.name ===
					JSON.parse(init?.body as string).name.toLowerCase(),
			);
			return hasSameName
				? failure(400, [
						{
							code: 81_053,
							message:
								"An A, AAAA, or CNAME record with that host already exists.",
						},
					])
				: envelope(record({ id: "new" }));
		}
		if (url.pathname.startsWith(`${ZONE_PATH}/dns_records/`)) {
			if (method === "DELETE" && deleteStatus !== 200) {
				return failure(deleteStatus, [
					{ code: 81_044, message: "Record does not exist." },
				]);
			}
			return envelope({ id: url.pathname.split("/").at(-1) });
		}
		return failure(404, [{ code: 7003, message: "Could not route" }]);
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("helpers", () => {
	test("hostnameInZone accepts the apex and names below it, case and trailing dot insensitive", () => {
		expect(hostnameInZone("example.com", "example.com")).toBe(true);
		expect(hostnameInZone("App.Example.com.", "example.com")).toBe(true);
		expect(hostnameInZone("badexample.com", "example.com")).toBe(false);
	});

	test("formatCloudflareErrors renders the documented errors[] envelope", () => {
		expect(
			formatCloudflareErrors([
				{ code: 81_053, message: "already exists" },
				{ code: 1004, message: "DNS Validation Error" },
			]),
		).toBe("[81053] already exists; [1004] DNS Validation Error");
		expect(formatCloudflareErrors([])).toBeNull();
	});
});

describe("CloudflareService.syncDnsRecord", () => {
	test("returns null when the integration isn't configured", async () => {
		settings.cloudflareConfigured = false;

		expect(
			await CloudflareService.syncDnsRecord("app.example.com", "example.com"),
		).toBeNull();
		expect(requested).toEqual([]);
	});

	test("creates an unproxied, auto-TTL CNAME carrying the managed comment", async () => {
		const result = await CloudflareService.syncDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result).toEqual({
			detail: "created CNAME app.example.com -> example.com",
			ok: true,
			provider: "cloudflare",
		});
		expect(writes).toEqual([
			{
				body: {
					comment: CLOUDFLARE_MANAGED_COMMENT,
					content: "example.com",
					name: "app.example.com",
					proxied: false,
					ttl: 1,
					type: "CNAME",
				},
				method: "POST",
				path: `${ZONE_PATH}/dns_records`,
			},
		]);
		expect(
			requested.some((href) => href.includes("name.exact=app.example.com")),
		).toBe(true);
	});

	test("writes nothing when the CNAME already points at the target", async () => {
		records = [record({ content: "Example.com." })];

		const result = await CloudflareService.syncDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result?.ok).toBe(true);
		expect(result?.detail).toContain("already in place");
		expect(writes).toEqual([]);
	});

	test("patches only the content of a CNAME pointing elsewhere, keeping a hand-set proxy flag", async () => {
		records = [record({ content: "old.example.net", proxied: true, ttl: 300 })];

		const result = await CloudflareService.syncDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result?.detail).toBe(
			"updated CNAME app.example.com -> example.com (was old.example.net)",
		);
		expect(writes).toEqual([
			{
				body: {
					content: "example.com",
					name: "app.example.com",
					ttl: 300,
					type: "CNAME",
				},
				method: "PATCH",
				path: `${ZONE_PATH}/dns_records/372e67954025e0ba6aaa6d586b9e0b59`,
			},
		]);
	});

	test("recreates a record deleted out of band", async () => {
		records = [];

		const result = await CloudflareService.syncDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result?.detail).toStartWith("created");
	});

	test("leaves an A record on the same name alone and says why", async () => {
		records = [record({ content: "203.0.113.10", type: "A" })];

		const result = await CloudflareService.syncDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result?.ok).toBe(false);
		expect(result?.detail).toContain("an A record already exists");
		expect(writes).toEqual([]);
	});

	test("skips a hostname outside the zone without writing", async () => {
		const result = await CloudflareService.syncDnsRecord(
			"shop.other.org",
			"example.com",
		);

		expect(result?.ok).toBe(true);
		expect(result?.detail).toContain("outside the Cloudflare zone example.com");
		expect(writes).toEqual([]);
	});

	test("never makes a name a CNAME to itself", async () => {
		const result = await CloudflareService.syncDnsRecord(
			"example.com",
			"example.com",
		);

		expect(result?.ok).toBe(true);
		expect(requested).toEqual([]);
	});

	test("surfaces Cloudflare's own error codes", async () => {
		zoneName = "example.com";
		records = [];
		globalThis.fetch = (async () =>
			failure(403, [
				{ code: 9109, message: "Unauthorized to access requested resource" },
			])) as unknown as typeof fetch;

		const result = await CloudflareService.syncDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result?.ok).toBe(false);
		expect(result?.detail).toBe(
			"Cloudflare API 403: [9109] Unauthorized to access requested resource",
		);
	});

	test("names the Retry-After delay on a 429", async () => {
		rateLimited = true;

		const result = await CloudflareService.syncDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result?.ok).toBe(false);
		expect(result?.detail).toContain("rate limited, retry in 42 seconds");
	});

	test("reports a non-JSON edge error page instead of throwing a SyntaxError", async () => {
		globalThis.fetch = (async () =>
			new Response("<html>502 Bad Gateway</html>", {
				status: 502,
			})) as unknown as typeof fetch;

		const result = await CloudflareService.syncDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result?.detail).toBe("Cloudflare API 502 returned no JSON body");
	});
});

describe("CloudflareService.deleteDnsRecord", () => {
	test("deletes a CNAME pointing at the target", async () => {
		records = [record({})];

		const result = await CloudflareService.deleteDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result?.detail).toBe("removed app.example.com");
		expect(writes.map((write) => write.method)).toEqual(["DELETE"]);
	});

	test("deletes a managed CNAME even after the target changed", async () => {
		records = [
			record({
				comment: CLOUDFLARE_MANAGED_COMMENT,
				content: "old.example.net",
			}),
		];

		await CloudflareService.deleteDnsRecord("app.example.com", "example.com");

		expect(writes.map((write) => write.method)).toEqual(["DELETE"]);
	});

	test("leaves a CNAME Homerun didn't create alone", async () => {
		records = [record({ content: "elsewhere.example.net" })];

		const result = await CloudflareService.deleteDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result?.ok).toBe(true);
		expect(result?.detail).toContain("alone");
		expect(writes).toEqual([]);
	});

	test("treats a record deleted between lookup and delete (404) as gone", async () => {
		records = [record({})];
		deleteStatus = 404;

		const result = await CloudflareService.deleteDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result?.ok).toBe(true);
	});

	test("reports nothing to do when no record exists", async () => {
		const result = await CloudflareService.deleteDnsRecord(
			"app.example.com",
			"example.com",
		);

		expect(result?.detail).toBe("no record for app.example.com");
	});
});

describe("CloudflareService.verifyZoneAccess", () => {
	test("passes with the zone name when the token can read the zone and its records", async () => {
		const result = await CloudflareService.verifyZoneAccess(
			"good-token",
			ZONE_ID,
			"example.com",
		);

		expect(result).toEqual({
			detail: "zone example.com, DNS records readable",
			success: true,
		});
		expect(requested.at(-1)).toContain("dns_records?per_page=1");
	});

	test("fails when the zone doesn't hold the base domain", async () => {
		const result = await CloudflareService.verifyZoneAccess(
			"good-token",
			ZONE_ID,
			"apps.other.org",
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("doesn't hold the base domain");
	});

	test("mentions a zone that isn't active yet", async () => {
		zoneStatus = "pending";

		const result = await CloudflareService.verifyZoneAccess(
			"good-token",
			ZONE_ID,
		);

		expect(result.detail).toContain("zone status is pending");
	});

	test("surfaces an authentication error from the envelope", async () => {
		const result = await CloudflareService.verifyZoneAccess("wrong", ZONE_ID);

		expect(result).toEqual({
			error: "Cloudflare API 401: [10000] Authentication error",
			success: false,
		});
	});
});
