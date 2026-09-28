import { afterEach, describe, expect, test } from "bun:test";
import { hetzner } from "../../../../src/lib/services/dns-providers/hetzner";
import { stubFetch } from "./stub-fetch";

const zone = { id: "42", name: "example.com" };
const API = "https://api.hetzner.cloud/v1";
const action = { action: { id: 1, status: "running" } };

afterEach(() => stubFetch.restore());

describe("Hetzner", () => {
	test("lists every page of zones with a bearer token", async () => {
		const calls = stubFetch((request) => {
			const page = Number(new URL(request.url).searchParams.get("page"));
			return {
				meta: { pagination: { next_page: page === 1 ? 2 : null } },
				zones: [{ id: page, name: page === 1 ? "Example.com" : "other.org" }],
			};
		});
		expect(await hetzner.create({ apiToken: "tok" }).listZones()).toEqual([
			{ id: "1", name: "example.com" },
			{ id: "2", name: "other.org" },
		]);
		expect(calls.map((call) => call.url)).toEqual([
			`${API}/zones?page=1&per_page=50`,
			`${API}/zones?page=2&per_page=50`,
		]);
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.headers.get("authorization")).toBe("Bearer tok");
	});

	test("flattens RRSets into one record per value", async () => {
		const calls = stubFetch((request) => {
			const page = Number(new URL(request.url).searchParams.get("page"));
			return page === 1
				? {
						meta: { pagination: { next_page: 2 } },
						rrsets: [
							{
								name: "www",
								records: [{ value: "app.example.net." }],
								ttl: null,
								type: "CNAME",
							},
							{
								name: "@",
								records: [{ value: '"v=spf1 " "-all"' }],
								ttl: 300,
								type: "TXT",
							},
						],
					}
				: {
						meta: { pagination: { next_page: null } },
						rrsets: [
							{
								name: "@",
								records: [{ value: "10 mx.example.com." }],
								ttl: 3600,
								type: "MX",
							},
						],
					};
		});
		expect(await hetzner.create({ apiToken: "tok" }).listRecords(zone)).toEqual(
			[
				{
					content: "app.example.net",
					id: "www/CNAME/app.example.net.",
					name: "www.example.com",
					priority: null,
					ttl: null,
					type: "CNAME",
				},
				{
					content: "v=spf1 -all",
					id: '@/TXT/"v=spf1 " "-all"',
					name: "example.com",
					priority: null,
					ttl: 300,
					type: "TXT",
				},
				{
					content: "mx.example.com",
					id: "@/MX/10 mx.example.com.",
					name: "example.com",
					priority: 10,
					ttl: 3600,
					type: "MX",
				},
			],
		);
		expect(calls[1]?.url).toBe(`${API}/zones/42/rrsets?page=2&per_page=50`);
	});

	test("creates, updates and deletes through RRSet actions, a 404 on delete counting as gone", async () => {
		const calls = stubFetch((request) =>
			request.url.endsWith("/app/TXT/actions/remove_records") &&
			request.body?.includes("gone")
				? {
						body: { error: { code: "not_found", message: "rrset not found" } },
						status: 404,
					}
				: action,
		);
		const client = hetzner.create({ apiToken: "tok" });
		const created = await client.createRecord(zone, {
			content: "hello",
			name: "app.example.com",
			ttl: 300,
			type: "TXT",
		});
		expect(created).toEqual({
			content: "hello",
			id: 'app/TXT/"hello"',
			name: "app.example.com",
			priority: null,
			ttl: 300,
			type: "TXT",
		});
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toBe(
			`${API}/zones/42/rrsets/app/TXT/actions/add_records`,
		);
		expect(calls[0]?.headers.get("content-type")).toBe("application/json");
		expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
			records: [{ value: '"hello"' }],
			ttl: 300,
		});

		const updated = await client.updateRecord(zone, created, {
			content: "target.example.net",
			name: "www.example.com",
			type: "CNAME",
		});
		expect(updated.id).toBe("www/CNAME/target.example.net.");
		expect(calls[1]?.url).toBe(
			`${API}/zones/42/rrsets/app/TXT/actions/remove_records`,
		);
		expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
			records: [{ value: '"hello"' }],
		});
		expect(calls[2]?.url).toBe(
			`${API}/zones/42/rrsets/www/CNAME/actions/add_records`,
		);
		expect(JSON.parse(calls[2]?.body ?? "{}")).toEqual({
			records: [{ value: "target.example.net." }],
		});

		await client.updateRecord(zone, updated, {
			content: "target.example.net",
			name: "www.example.com",
			ttl: 600,
			type: "CNAME",
		});
		expect(calls[3]?.url).toBe(
			`${API}/zones/42/rrsets/www/CNAME/actions/change_ttl`,
		);
		expect(JSON.parse(calls[3]?.body ?? "{}")).toEqual({ ttl: 600 });

		await client.createRecord(zone, {
			content: "mail.example.com",
			name: "example.com",
			priority: 20,
			type: "MX",
		});
		expect(calls[4]?.url).toBe(
			`${API}/zones/42/rrsets/@/MX/actions/add_records`,
		);
		expect(JSON.parse(calls[4]?.body ?? "{}")).toEqual({
			records: [{ value: "20 mail.example.com." }],
		});

		await client.deleteRecord(zone, { ...created, id: 'app/TXT/"gone"' });
		expect(calls[5]?.url).toBe(
			`${API}/zones/42/rrsets/app/TXT/actions/remove_records`,
		);
		expect(JSON.parse(calls[5]?.body ?? "{}")).toEqual({
			records: [{ value: '"gone"' }],
		});
	});

	test("a failed call names Hetzner's own error", async () => {
		stubFetch(() => ({
			body: {
				error: { code: "unauthorized", message: "unable to authenticate" },
			},
			status: 401,
		}));
		await expect(
			hetzner.create({ apiToken: "bad" }).listZones(),
		).rejects.toThrow("Hetzner 401: unable to authenticate");
	});
});
