import { afterEach, describe, expect, test } from "bun:test";
import { godaddy } from "../../../../src/lib/services/dns-providers/godaddy";
import { stubFetch } from "./stub-fetch";

const zone = { id: "example.com", name: "example.com" };
const API = "https://api.godaddy.com/v1";
const client = () => godaddy.create({ apiKey: "key", apiSecret: "secret" });

afterEach(() => stubFetch.restore());

describe("GoDaddy", () => {
	test("pages domains by marker and records by offset", async () => {
		const calls = stubFetch((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/v1/domains") {
				return url.searchParams.get("marker")
					? [{ domain: "zzz.org" }]
					: Array.from({ length: 1000 }, (_, index) => ({
							domain: index === 999 ? "last.com" : `d${index}.com`,
						}));
			}
			return url.searchParams.get("offset") === "0"
				? Array.from({ length: 500 }, () => ({
						data: "1.2.3.4",
						name: "@",
						ttl: 600,
						type: "A",
					}))
				: [
						{ data: "@", name: "www", ttl: 3600, type: "CNAME" },
						{
							data: "mx.example.net.",
							name: "@",
							priority: 10,
							ttl: 3600,
							type: "MX",
						},
						{ data: "v=spf1 -all", name: "@", ttl: 600, type: "TXT" },
					];
		});
		const zones = await client().listZones();
		expect(zones).toHaveLength(1001);
		expect(zones.at(-1)).toEqual({ id: "zzz.org", name: "zzz.org" });
		expect(calls[0]?.url).toBe(`${API}/domains?limit=1000`);
		expect(calls[1]?.url).toBe(`${API}/domains?limit=1000&marker=last.com`);
		expect(calls[0]?.headers.get("authorization")).toBe("sso-key key:secret");
		const records = await client().listRecords(zone);
		expect(calls[2]?.url).toBe(
			`${API}/domains/example.com/records?offset=0&limit=500`,
		);
		expect(calls[3]?.url).toBe(
			`${API}/domains/example.com/records?offset=500&limit=500`,
		);
		expect(records).toHaveLength(503);
		expect(records.slice(500)).toEqual([
			{
				content: "example.com",
				id: "CNAME:www.example.com::example.com",
				name: "www.example.com",
				priority: null,
				ttl: 3600,
				type: "CNAME",
			},
			{
				content: "mx.example.net",
				id: "MX:example.com:10:mx.example.net",
				name: "example.com",
				priority: 10,
				ttl: 3600,
				type: "MX",
			},
			{
				content: "v=spf1 -all",
				id: "TXT:example.com::v=spf1 -all",
				name: "example.com",
				priority: null,
				ttl: 600,
				type: "TXT",
			},
		]);
	});

	test("PATCHes to add, PUTs the rrset to update or trim it, deletes it when emptied", async () => {
		let rrset: unknown[] = [
			{ data: "1.1.1.1", name: "app", ttl: 600, type: "A" },
			{ data: "2.2.2.2", name: "app", ttl: 600, type: "A" },
		];
		const calls = stubFetch((request) =>
			request.method === "GET"
				? rrset
				: request.method === "DELETE"
					? { body: { code: "NOT_FOUND", message: "gone" }, status: 404 }
					: undefined,
		);
		const created = await client().createRecord(zone, {
			content: "2.2.2.2",
			name: "app.example.com",
			ttl: 600,
			type: "A",
		});
		expect(created.id).toBe("A:app.example.com::2.2.2.2");
		expect(`${calls[0]?.method} ${calls[0]?.url}`).toBe(
			`PATCH ${API}/domains/example.com/records`,
		);
		expect(JSON.parse(calls[0]?.body ?? "[]")).toEqual([
			{ data: "2.2.2.2", name: "app", ttl: 600, type: "A" },
		]);
		await client().updateRecord(zone, created, {
			content: "3.3.3.3",
			name: "app.example.com",
			type: "A",
		});
		expect(`${calls[1]?.method} ${calls[1]?.url}`).toBe(
			`GET ${API}/domains/example.com/records/A/app`,
		);
		expect(`${calls[2]?.method} ${calls[2]?.url}`).toBe(
			`PUT ${API}/domains/example.com/records/A/app`,
		);
		expect(JSON.parse(calls[2]?.body ?? "[]")).toEqual([
			{ data: "1.1.1.1", ttl: 600 },
			{ data: "3.3.3.3" },
		]);
		await client().deleteRecord(zone, created);
		expect(JSON.parse(calls[4]?.body ?? "[]")).toEqual([
			{ data: "1.1.1.1", ttl: 600 },
		]);
		rrset = [{ data: "2.2.2.2", name: "app", ttl: 600, type: "A" }];
		await client().deleteRecord(zone, created);
		expect(`${calls[6]?.method} ${calls[6]?.url}`).toBe(
			`DELETE ${API}/domains/example.com/records/A/app`,
		);
		await client().updateRecord(zone, created, {
			content: "mx.example.net",
			name: "example.com",
			priority: 5,
			type: "MX",
		});
		expect(calls.slice(7).map((call) => `${call.method} ${call.url}`)).toEqual([
			`GET ${API}/domains/example.com/records/A/app`,
			`DELETE ${API}/domains/example.com/records/A/app`,
			`PATCH ${API}/domains/example.com/records`,
		]);
		expect(JSON.parse(calls[9]?.body ?? "[]")).toEqual([
			{ data: "mx.example.net", name: "@", priority: 5, type: "MX" },
		]);
	});

	test("an access-denied account gets GoDaddy's message and why", async () => {
		stubFetch(() => ({
			body: {
				code: "ACCESS_DENIED",
				message: "Authenticated user is not allowed access",
			},
			status: 403,
		}));
		await expect(client().listZones()).rejects.toThrow(
			"GoDaddy 403: ACCESS_DENIED: Authenticated user is not allowed access (GoDaddy only opens its production API to accounts with 10 or more domains",
		);
		stubFetch(() => ({
			body: {
				code: "INVALID_BODY",
				fields: [{ message: "must be at least 600", path: "records[0].ttl" }],
				message: "Request body doesn't fulfill schema",
			},
			status: 422,
		}));
		await expect(client().listRecords(zone)).rejects.toThrow(
			"GoDaddy 422: INVALID_BODY: Request body doesn't fulfill schema [records[0].ttl: must be at least 600]",
		);
	});
});
