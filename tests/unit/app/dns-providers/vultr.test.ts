import { afterEach, describe, expect, test } from "bun:test";
import { vultr } from "../../../../src/lib/services/dns-providers/vultr";
import { stubFetch } from "./stub-fetch";

const zone = { id: "example.com", name: "example.com" };
const API = "https://api.vultr.com/v2";

afterEach(() => stubFetch.restore());

describe("Vultr", () => {
	test("follows the cursor through every page of domains with a bearer token", async () => {
		const calls = stubFetch((request) =>
			new URL(request.url).searchParams.get("cursor")
				? {
						domains: [{ domain: "other.org" }],
						meta: { links: { next: "", prev: "abc" }, total: 2 },
					}
				: {
						domains: [{ domain: "Example.com" }],
						meta: { links: { next: "abc", prev: "" }, total: 2 },
					},
		);
		expect(await vultr.create({ apiKey: "key" }).listZones()).toEqual([
			{ id: "example.com", name: "example.com" },
			{ id: "other.org", name: "other.org" },
		]);
		expect(calls.map((call) => call.url)).toEqual([
			`${API}/domains?per_page=500`,
			`${API}/domains?per_page=500&cursor=abc`,
		]);
		expect(calls[0]?.headers.get("authorization")).toBe("Bearer key");
	});

	test("maps records into the common shape", async () => {
		const calls = stubFetch(() => ({
			meta: { links: { next: "", prev: "" }, total: 3 },
			records: [
				{
					data: "app.example.net.",
					id: "r1",
					name: "www",
					priority: -1,
					ttl: 300,
					type: "CNAME",
				},
				{
					data: '"v=spf1 -all"',
					id: "r2",
					name: "",
					priority: -1,
					ttl: 300,
					type: "TXT",
				},
				{
					data: "mx.example.com",
					id: "r3",
					name: "",
					priority: 10,
					ttl: 3600,
					type: "MX",
				},
			],
		}));
		expect(await vultr.create({ apiKey: "key" }).listRecords(zone)).toEqual([
			{
				content: "app.example.net",
				id: "r1",
				name: "www.example.com",
				priority: null,
				ttl: 300,
				type: "CNAME",
			},
			{
				content: "v=spf1 -all",
				id: "r2",
				name: "example.com",
				priority: null,
				ttl: 300,
				type: "TXT",
			},
			{
				content: "mx.example.com",
				id: "r3",
				name: "example.com",
				priority: 10,
				ttl: 3600,
				type: "MX",
			},
		]);
		expect(calls[0]?.url).toBe(
			`${API}/domains/example.com/records?per_page=500`,
		);
	});

	test("creates with quoted TXT, patches, and a 404 on delete counts as gone", async () => {
		const calls = stubFetch((request) => {
			if (request.method === "DELETE") {
				return { body: { error: "Invalid record.", status: 404 }, status: 404 };
			}
			if (request.method === "PATCH") {
				return { body: undefined, status: 204 };
			}
			return {
				record: {
					data: '"hello"',
					id: "r9",
					name: "app",
					priority: -1,
					ttl: 300,
					type: "TXT",
				},
			};
		});
		const client = vultr.create({ apiKey: "key" });
		const created = await client.createRecord(zone, {
			content: "hello",
			name: "app.example.com",
			ttl: 300,
			type: "TXT",
		});
		expect(created).toEqual({
			content: "hello",
			id: "r9",
			name: "app.example.com",
			priority: null,
			ttl: 300,
			type: "TXT",
		});
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toBe(`${API}/domains/example.com/records`);
		expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
			data: '"hello"',
			name: "app",
			ttl: 300,
			type: "TXT",
		});

		const updated = await client.updateRecord(zone, created, {
			content: "mail.example.com",
			name: "example.com",
			priority: 20,
			type: "MX",
		});
		expect(updated).toEqual({
			content: "mail.example.com",
			id: "r9",
			name: "example.com",
			priority: 20,
			ttl: 300,
			type: "MX",
		});
		expect(calls[1]?.method).toBe("PATCH");
		expect(calls[1]?.url).toBe(`${API}/domains/example.com/records/r9`);
		expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
			data: "mail.example.com",
			name: "",
			priority: 20,
			type: "MX",
		});

		await client.deleteRecord(zone, created);
		expect(calls[2]?.method).toBe("DELETE");
		expect(calls[2]?.url).toBe(`${API}/domains/example.com/records/r9`);
	});

	test("a failed call names Vultr's own error", async () => {
		stubFetch(() => ({
			body: { error: "Invalid API token.", status: 401 },
			status: 401,
		}));
		await expect(vultr.create({ apiKey: "bad" }).listZones()).rejects.toThrow(
			"Vultr 401: Invalid API token.",
		);
	});
});
