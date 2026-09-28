import { afterEach, describe, expect, test } from "bun:test";
import { gandi } from "../../../../src/lib/services/dns-providers/gandi";
import { stubFetch } from "./stub-fetch";

const zone = { id: "example.com", name: "example.com" };
const API = "https://api.gandi.net/v5/livedns";

afterEach(() => stubFetch.restore());

describe("Gandi", () => {
	test("lists every page of domains and spreads rrsets into records", async () => {
		const calls = stubFetch((request) => {
			const url = new URL(request.url);
			if (url.pathname.endsWith("/domains")) {
				return url.searchParams.get("page") === "1"
					? Array.from({ length: 100 }, (_, index) => ({
							fqdn: index ? `d${index}.org` : "Example.com",
						}))
					: [{ fqdn: "last.net" }];
			}
			return [
				{
					rrset_name: "www",
					rrset_ttl: 10800,
					rrset_type: "CNAME",
					rrset_values: ["example.com."],
				},
				{
					rrset_name: "@",
					rrset_ttl: 300,
					rrset_type: "TXT",
					rrset_values: ['"v=spf1 -all"', '"a" "b"'],
				},
				{
					rrset_name: "@",
					rrset_ttl: 300,
					rrset_type: "MX",
					rrset_values: ["10 mail.example.com."],
				},
			];
		});
		const client = gandi.create({ token: "pat" });
		const zones = await client.listZones();
		expect(zones).toHaveLength(101);
		expect(zones[0]).toEqual({ id: "example.com", name: "example.com" });
		expect(zones[100]).toEqual({ id: "last.net", name: "last.net" });
		expect(calls.map((call) => call.url)).toEqual([
			`${API}/domains?per_page=100&page=1`,
			`${API}/domains?per_page=100&page=2`,
		]);
		expect(calls[0]?.headers.get("authorization")).toBe("Bearer pat");
		expect(await client.listRecords(zone)).toEqual([
			{
				content: "example.com",
				id: "CNAME:www.example.com:example.com",
				name: "www.example.com",
				priority: null,
				ttl: 10800,
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
				content: "ab",
				id: "TXT:example.com:ab",
				name: "example.com",
				priority: null,
				ttl: 300,
				type: "TXT",
			},
			{
				content: "mail.example.com",
				id: "MX:example.com:mail.example.com",
				name: "example.com",
				priority: 10,
				ttl: 300,
				type: "MX",
			},
		]);
		expect(calls[2]?.url).toBe(
			`${API}/domains/example.com/records?per_page=100&page=1`,
		);
	});

	test("creates a new rrset, then adds, replaces and removes one value keeping the others", async () => {
		let values: string[] | null = null;
		const calls = stubFetch((request) => {
			if (request.method === "GET") {
				return values
					? {
							rrset_name: "@",
							rrset_ttl: 300,
							rrset_type: "TXT",
							rrset_values: values,
						}
					: { body: { message: "Not found" }, status: 404 };
			}
			if (request.method === "POST") {
				values = JSON.parse(request.body ?? "{}").rrset_values;
				return { status: 201, body: { message: "DNS Record Created" } };
			}
			if (request.method === "PUT") {
				values = JSON.parse(request.body ?? "{}").rrset_values;
				return { message: "DNS Record Created" };
			}
			values = null;
			return { status: 204, body: undefined };
		});
		const client = gandi.create({ token: "pat" });
		const first = await client.createRecord(zone, {
			content: "one",
			name: "example.com",
			type: "TXT",
		});
		expect(first.id).toBe("TXT:example.com:one");
		expect(calls[1]?.url).toBe(`${API}/domains/example.com/records`);
		expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
			rrset_name: "@",
			rrset_type: "TXT",
			rrset_values: ['"one"'],
		});
		await client.createRecord(zone, {
			content: 'say "hi"',
			name: "example.com",
			ttl: 600,
			type: "TXT",
		});
		expect(calls[3]?.method).toBe("PUT");
		expect(calls[3]?.url).toBe(`${API}/domains/example.com/records/%40/TXT`);
		expect(JSON.parse(calls[3]?.body ?? "{}")).toEqual({
			rrset_ttl: 600,
			rrset_values: ['"one"', '"say \\"hi\\""'],
		});
		await client.updateRecord(zone, first, {
			content: "uno",
			name: "example.com",
			type: "TXT",
		});
		expect(JSON.parse(calls[5]?.body ?? "{}")).toEqual({
			rrset_ttl: 300,
			rrset_values: ['"uno"', '"say \\"hi\\""'],
		});
		await client.deleteRecord(zone, {
			...first,
			content: 'say "hi"',
		});
		expect(JSON.parse(calls[7]?.body ?? "{}").rrset_values).toEqual(['"uno"']);
		await client.deleteRecord(zone, { ...first, content: "uno" });
		expect(calls[9]?.method).toBe("DELETE");
		expect(values).toBeNull();
		await client.deleteRecord(zone, first);
		expect(calls).toHaveLength(11);
	});

	test("a failed call names Gandi's own error", async () => {
		stubFetch(() => ({
			body: {
				cause: "Forbidden",
				code: 403,
				message: "Access was denied to this resource.",
				object: "HTTPForbidden",
			},
			status: 403,
		}));
		await expect(gandi.create({ token: "bad" }).listZones()).rejects.toThrow(
			"Gandi 403: Access was denied to this resource.",
		);
	});
});
