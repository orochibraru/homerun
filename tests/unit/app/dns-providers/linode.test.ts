import { afterEach, describe, expect, test } from "bun:test";
import { linode } from "../../../../src/lib/services/dns-providers/linode";
import { stubFetch } from "./stub-fetch";

const zone = { id: "7", name: "example.com" };
const API = "https://api.linode.com/v4";
const record = (fields: Record<string, unknown>) => ({
	port: 0,
	priority: 0,
	protocol: null,
	service: null,
	tag: null,
	ttl_sec: 0,
	weight: 0,
	...fields,
});

afterEach(() => stubFetch.restore());

describe("Linode", () => {
	test("lists every page of master domains with a bearer token", async () => {
		const calls = stubFetch((request) => {
			const page = Number(new URL(request.url).searchParams.get("page"));
			return {
				data:
					page === 1
						? [
								{ domain: "Example.com", id: 7, type: "master" },
								{ domain: "secondary.net", id: 8, type: "slave" },
							]
						: [{ domain: "other.org", id: 9, type: "master" }],
				page,
				pages: 2,
				results: 3,
			};
		});
		expect(await linode.create({ apiToken: "tok" }).listZones()).toEqual([
			{ id: "7", name: "example.com" },
			{ id: "9", name: "other.org" },
		]);
		expect(calls.map((call) => call.url)).toEqual([
			`${API}/domains?page=1&page_size=500`,
			`${API}/domains?page=2&page_size=500`,
		]);
		expect(calls[0]?.headers.get("authorization")).toBe("Bearer tok");
	});

	test("maps records into the common shape", async () => {
		const calls = stubFetch(() => ({
			data: [
				record({
					id: 1,
					name: "www",
					target: "app.example.net.",
					type: "CNAME",
				}),
				record({
					id: 2,
					name: "",
					target: '"v=spf1 -all"',
					ttl_sec: 300,
					type: "TXT",
				}),
				record({
					id: 3,
					name: "",
					priority: 10,
					target: "mx.example.com",
					type: "MX",
				}),
				record({
					id: 4,
					name: "",
					tag: "issue",
					target: "letsencrypt.org",
					type: "CAA",
				}),
			],
			page: 1,
			pages: 1,
			results: 4,
		}));
		expect(await linode.create({ apiToken: "tok" }).listRecords(zone)).toEqual([
			{
				content: "app.example.net",
				id: "1",
				name: "www.example.com",
				priority: null,
				ttl: null,
				type: "CNAME",
			},
			{
				content: "v=spf1 -all",
				id: "2",
				name: "example.com",
				priority: null,
				ttl: 300,
				type: "TXT",
			},
			{
				content: "mx.example.com",
				id: "3",
				name: "example.com",
				priority: 10,
				ttl: null,
				type: "MX",
			},
			{
				content: '0 issue "letsencrypt.org"',
				id: "4",
				name: "example.com",
				priority: null,
				ttl: null,
				type: "CAA",
			},
		]);
		expect(calls[0]?.url).toBe(`${API}/domains/7/records?page=1&page_size=500`);
	});

	test("creates, updates with PUT, and a 404 on delete counts as gone", async () => {
		const calls = stubFetch((request) =>
			request.method === "DELETE"
				? { body: { errors: [{ reason: "Not found" }] }, status: 404 }
				: record({
						id: 5,
						name: "app",
						target: "1.2.3.4",
						ttl_sec: 300,
						type: "A",
					}),
		);
		const client = linode.create({ apiToken: "tok" });
		const created = await client.createRecord(zone, {
			content: "1.2.3.4",
			name: "app.example.com",
			ttl: 300,
			type: "A",
		});
		expect(created).toEqual({
			content: "1.2.3.4",
			id: "5",
			name: "app.example.com",
			priority: null,
			ttl: 300,
			type: "A",
		});
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toBe(`${API}/domains/7/records`);
		expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
			name: "app",
			target: "1.2.3.4",
			ttl_sec: 300,
			type: "A",
		});

		await client.updateRecord(zone, created, {
			content: "mail.example.com",
			name: "example.com",
			priority: 20,
			type: "MX",
		});
		expect(calls[1]?.method).toBe("PUT");
		expect(calls[1]?.url).toBe(`${API}/domains/7/records/5`);
		expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
			name: "",
			priority: 20,
			target: "mail.example.com",
			ttl_sec: 0,
			type: "MX",
		});

		await client.deleteRecord(zone, created);
		expect(calls[2]?.method).toBe("DELETE");
		expect(calls[2]?.url).toBe(`${API}/domains/7/records/5`);
	});

	test("a failed call names Linode's own error", async () => {
		stubFetch(() => ({
			body: { errors: [{ reason: "Invalid Token" }] },
			status: 401,
		}));
		await expect(
			linode.create({ apiToken: "bad" }).listZones(),
		).rejects.toThrow("Linode 401: Invalid Token");
	});
});
