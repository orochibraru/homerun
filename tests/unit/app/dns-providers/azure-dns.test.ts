import { afterEach, describe, expect, test } from "bun:test";
import { azureDns } from "../../../../src/lib/services/dns-providers/azure-dns";
import { type StubbedCall, stubFetch } from "./stub-fetch";

const TOKEN_URL =
	"https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token";
const ZONE_ID =
	"/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Network/dnszones/example.com";
const ZONE_URL = `https://management.azure.com${ZONE_ID}`;
const zone = { id: ZONE_ID, name: "example.com" };
const credentials = {
	clientId: "client-1",
	clientSecret: "secret-1",
	subscriptionId: "sub-1",
	tenantId: "tenant-1",
};

/** Answers the token exchange, and hands every other call to `handler`. */
function withToken(handler: (request: StubbedCall) => unknown) {
	return stubFetch((request) =>
		request.url === TOKEN_URL
			? { access_token: "at-1", expires_in: 3599, token_type: "Bearer" }
			: handler(request),
	);
}

afterEach(() => stubFetch.restore());

describe("Azure DNS", () => {
	test("gets a client-credentials token once, and lists every page of zones in the subscription", async () => {
		const calls = withToken((request) =>
			request.url.includes("skipToken")
				? { value: [{ id: `${ZONE_ID}-2`, name: "Other.org" }] }
				: {
						nextLink:
							"https://management.azure.com/subscriptions/sub-1/providers/Microsoft.Network/dnszones?api-version=2018-05-01&$skipToken=abc",
						value: [{ id: ZONE_ID, name: "example.com" }],
					},
		);
		const client = azureDns.create(credentials);
		expect(await client.listZones()).toEqual([
			{ id: ZONE_ID, name: "example.com" },
			{ id: `${ZONE_ID}-2`, name: "other.org" },
		]);
		await client.listZones();
		expect(calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(1);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.headers.get("content-type")).toBe(
			"application/x-www-form-urlencoded",
		);
		expect(
			Object.fromEntries(new URLSearchParams(calls[0]?.body ?? "")),
		).toEqual({
			client_id: "client-1",
			client_secret: "secret-1",
			grant_type: "client_credentials",
			scope: "https://management.azure.com/.default",
		});
		expect(calls[1]?.url).toBe(
			"https://management.azure.com/subscriptions/sub-1/providers/Microsoft.Network/dnszones?api-version=2018-05-01",
		);
		expect(calls[1]?.headers.get("authorization")).toBe("Bearer at-1");
		expect(calls[2]?.url).toContain("$skipToken=abc");
	});

	test("scopes the zone list to a resource group", async () => {
		const calls = withToken(() => ({ value: [] }));
		await azureDns.create({ ...credentials, resourceGroup: "rg1" }).listZones();
		expect(calls[1]?.url).toBe(
			"https://management.azure.com/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Network/dnszones?api-version=2018-05-01",
		);
	});

	test("splits every record set into one record per value", async () => {
		const calls = withToken(() => ({
			value: [
				{
					name: "@",
					properties: {
						MXRecords: [{ exchange: "mx1.example.com.", preference: 10 }],
						TTL: 3600,
						fqdn: "example.com.",
					},
					type: "Microsoft.Network/dnszones/MX",
				},
				{
					name: "app",
					properties: {
						CNAMERecord: { cname: "example.com." },
						TTL: 60,
					},
					type: "Microsoft.Network/dnszones/CNAME",
				},
				{
					name: "@",
					properties: {
						TTL: 300,
						TXTRecords: [{ value: ["v=spf1 ", "-all"] }, { value: ["x"] }],
					},
					type: "Microsoft.Network/dnszones/TXT",
				},
				{
					name: "@",
					properties: {
						TTL: 300,
						caaRecords: [{ flags: 0, tag: "issue", value: "letsencrypt.org" }],
					},
					type: "Microsoft.Network/dnszones/CAA",
				},
			],
		}));
		const records = await azureDns.create(credentials).listRecords(zone);
		expect(calls[1]?.url).toBe(`${ZONE_URL}/all?api-version=2018-05-01`);
		expect(records).toEqual([
			{
				content: "mx1.example.com",
				id: "MX:example.com:mx1.example.com",
				name: "example.com",
				priority: 10,
				ttl: 3600,
				type: "MX",
			},
			{
				content: "example.com",
				id: "CNAME:app.example.com:example.com",
				name: "app.example.com",
				priority: null,
				ttl: 60,
				type: "CNAME",
			},
			{
				content: "v=spf1 -all",
				id: "TXT:example.com:v=spf1 -all",
				name: "example.com",
				priority: null,
				ttl: 300,
				type: "TXT",
			},
			{
				content: "x",
				id: "TXT:example.com:x",
				name: "example.com",
				priority: null,
				ttl: 300,
				type: "TXT",
			},
			{
				content: '0 issue "letsencrypt.org"',
				id: 'CAA:example.com:0 issue "letsencrypt.org"',
				name: "example.com",
				priority: null,
				ttl: 300,
				type: "CAA",
			},
		]);
	});

	test("puts the whole record set on create, update and delete, and deletes it once empty", async () => {
		const sets: Record<string, unknown> = {
			"A/app": {
				name: "app",
				properties: { ARecords: [{ ipv4Address: "1.1.1.1" }], TTL: 600 },
			},
		};
		const calls = withToken((request) => {
			const path = new URL(request.url).pathname.slice(ZONE_ID.length + 1);
			if (request.method === "GET") {
				return (
					sets[path] ?? {
						body: { error: { code: "NotFound", message: "gone" } },
						status: 404,
					}
				);
			}
			return request.method === "DELETE"
				? { status: 200, body: undefined }
				: {};
		});
		const client = azureDns.create(credentials);

		const created = await client.createRecord(zone, {
			content: "2.2.2.2",
			name: "app.example.com",
			type: "A",
		});
		expect(created).toEqual({
			content: "2.2.2.2",
			id: "A:app.example.com:2.2.2.2",
			name: "app.example.com",
			priority: null,
			ttl: 600,
			type: "A",
		});
		expect(calls[1]?.url).toBe(`${ZONE_URL}/A/app?api-version=2018-05-01`);
		expect(calls[2]?.method).toBe("PUT");
		expect(calls[2]?.url).toBe(`${ZONE_URL}/A/app?api-version=2018-05-01`);
		expect(JSON.parse(calls[2]?.body ?? "{}")).toEqual({
			properties: {
				ARecords: [{ ipv4Address: "1.1.1.1" }, { ipv4Address: "2.2.2.2" }],
				TTL: 600,
			},
		});

		await client.createRecord(zone, {
			content: "mx.example.com",
			name: "example.com",
			priority: 5,
			ttl: 120,
			type: "MX",
		});
		expect(calls[3]?.url).toBe(`${ZONE_URL}/MX/@?api-version=2018-05-01`);
		expect(JSON.parse(calls[4]?.body ?? "{}")).toEqual({
			properties: {
				MXRecords: [{ exchange: "mx.example.com", preference: 5 }],
				TTL: 120,
			},
		});

		await client.createRecord(zone, {
			content: '0 issue "letsencrypt.org"',
			name: "example.com",
			type: "CAA",
		});
		expect(JSON.parse(calls[6]?.body ?? "{}")).toEqual({
			properties: {
				TTL: 3600,
				caaRecords: [{ flags: 0, tag: "issue", value: "letsencrypt.org" }],
			},
		});

		sets["A/app"] = {
			name: "app",
			properties: {
				ARecords: [{ ipv4Address: "1.1.1.1" }, { ipv4Address: "2.2.2.2" }],
				TTL: 600,
			},
		};
		await client.updateRecord(zone, created, {
			content: "3.3.3.3",
			name: "app.example.com",
			type: "A",
		});
		expect(JSON.parse(calls[8]?.body ?? "{}").properties.ARecords).toEqual([
			{ ipv4Address: "1.1.1.1" },
			{ ipv4Address: "3.3.3.3" },
		]);

		sets["A/app"] = {
			name: "app",
			properties: { ARecords: [{ ipv4Address: "2.2.2.2" }], TTL: 600 },
		};
		await client.deleteRecord(zone, created);
		expect(calls[10]?.method).toBe("DELETE");
		expect(calls[10]?.url).toBe(`${ZONE_URL}/A/app?api-version=2018-05-01`);

		delete sets["A/app"];
		const before = calls.length;
		await client.deleteRecord(zone, created);
		expect(calls).toHaveLength(before + 1);
	});

	test("a failed call names Azure's own error", async () => {
		withToken(() => ({
			body: {
				error: {
					code: "AuthorizationFailed",
					message: "The client does not have authorization.",
				},
			},
			status: 403,
		}));
		await expect(azureDns.create(credentials).listZones()).rejects.toThrow(
			"Azure DNS 403: AuthorizationFailed: The client does not have authorization.",
		);
	});

	test("a rejected token request names the Entra error", async () => {
		stubFetch(() => ({
			body: {
				error: "invalid_client",
				error_description:
					"AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x",
			},
			status: 401,
		}));
		await expect(azureDns.create(credentials).listZones()).rejects.toThrow(
			"Azure DNS 401: invalid_client: AADSTS7000215: Invalid client secret provided.",
		);
	});
});
