import { afterEach, describe, expect, test } from "bun:test";
import { digitalocean } from "../../../../src/lib/services/dns-providers/digitalocean";
import { stubFetch } from "./stub-fetch";

const zone = { id: "example.com", name: "example.com" };
const API = "https://api.digitalocean.com/v2";
const record = (fields: Record<string, unknown>) => ({
	flags: null,
	port: null,
	priority: null,
	tag: null,
	ttl: 1800,
	weight: null,
	...fields,
});

afterEach(() => stubFetch.restore());

describe("DigitalOcean", () => {
	test("lists every page of domains with a bearer token", async () => {
		const calls = stubFetch((request) => {
			const page = new URL(request.url).searchParams.get("page");
			return page === "1"
				? {
						domains: [{ name: "Example.com", ttl: 1800 }],
						links: {
							pages: {
								last: `${API}/domains?page=2`,
								next: `${API}/domains?page=2`,
							},
						},
						meta: { total: 2 },
					}
				: {
						domains: [{ name: "other.org", ttl: 1800 }],
						links: {},
						meta: { total: 2 },
					};
		});
		expect(await digitalocean.create({ apiToken: "tok" }).listZones()).toEqual([
			{ id: "example.com", name: "example.com" },
			{ id: "other.org", name: "other.org" },
		]);
		expect(calls.map((call) => call.url)).toEqual([
			`${API}/domains?per_page=200&page=1`,
			`${API}/domains?per_page=200&page=2`,
		]);
		expect(calls[0]?.headers.get("authorization")).toBe("Bearer tok");
	});

	test("maps records into the common shape", async () => {
		const calls = stubFetch(() => ({
			domain_records: [
				record({ data: "app.example.net.", id: 1, name: "www", type: "CNAME" }),
				record({ data: '"v=spf1 -all"', id: 2, name: "@", type: "TXT" }),
				record({ data: "@", id: 3, name: "@", priority: 10, type: "MX" }),
				record({
					data: "letsencrypt.org",
					flags: 0,
					id: 4,
					name: "@",
					tag: "issue",
					type: "CAA",
				}),
			],
			links: {},
			meta: { total: 4 },
		}));
		expect(
			await digitalocean.create({ apiToken: "tok" }).listRecords(zone),
		).toEqual([
			{
				content: "app.example.net",
				id: "1",
				name: "www.example.com",
				priority: null,
				ttl: 1800,
				type: "CNAME",
			},
			{
				content: "v=spf1 -all",
				id: "2",
				name: "example.com",
				priority: null,
				ttl: 1800,
				type: "TXT",
			},
			{
				content: "example.com",
				id: "3",
				name: "example.com",
				priority: 10,
				ttl: 1800,
				type: "MX",
			},
			{
				content: '0 issue "letsencrypt.org"',
				id: "4",
				name: "example.com",
				priority: null,
				ttl: 1800,
				type: "CAA",
			},
		]);
		expect(calls[0]?.url).toBe(
			`${API}/domains/example.com/records?per_page=200&page=1`,
		);
	});

	test("creates, updates with PUT, and a 404 on delete counts as gone", async () => {
		const calls = stubFetch((request) =>
			request.method === "DELETE"
				? {
						body: {
							id: "not_found",
							message: "The resource you requested could not be found.",
						},
						status: 404,
					}
				: {
						domain_record: record({
							data: "mail.example.com.",
							id: 9,
							name: "@",
							priority: 5,
							type: "MX",
						}),
					},
		);
		const client = digitalocean.create({ apiToken: "tok" });
		const created = await client.createRecord(zone, {
			content: "mail.example.com",
			name: "example.com",
			priority: 5,
			type: "MX",
		});
		expect(created).toEqual({
			content: "mail.example.com",
			id: "9",
			name: "example.com",
			priority: 5,
			ttl: 1800,
			type: "MX",
		});
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toBe(`${API}/domains/example.com/records`);
		expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
			data: "mail.example.com.",
			name: "@",
			priority: 5,
			type: "MX",
		});

		await client.updateRecord(zone, created, {
			content: '0 issuewild "letsencrypt.org"',
			name: "app.example.com",
			ttl: 300,
			type: "CAA",
		});
		expect(calls[1]?.method).toBe("PUT");
		expect(calls[1]?.url).toBe(`${API}/domains/example.com/records/9`);
		expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
			data: "letsencrypt.org",
			flags: 0,
			name: "app",
			tag: "issuewild",
			ttl: 300,
			type: "CAA",
		});

		await client.deleteRecord(zone, created);
		expect(calls[2]?.method).toBe("DELETE");
		expect(calls[2]?.url).toBe(`${API}/domains/example.com/records/9`);
	});

	test("a failed call names DigitalOcean's own error", async () => {
		stubFetch(() => ({
			body: { id: "Unauthorized", message: "Unable to authenticate you" },
			status: 401,
		}));
		await expect(
			digitalocean.create({ apiToken: "bad" }).listZones(),
		).rejects.toThrow("DigitalOcean 401: Unable to authenticate you");
	});
});
