import { afterEach, describe, expect, test } from "bun:test";
import { dnsimple } from "../../../../src/lib/services/dns-providers/dnsimple";
import { stubFetch } from "./stub-fetch";

const zone = { id: "example.com", name: "example.com" };
const API = "https://api.dnsimple.com/v2";

afterEach(() => stubFetch.restore());

describe("DNSimple", () => {
	test("discovers the account, then lists every page of zones and records", async () => {
		const calls = stubFetch((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/v2/whoami") {
				return { data: { account: null, user: { id: 7 } } };
			}
			if (url.pathname === "/v2/accounts") {
				return { data: [{ id: 1010 }] };
			}
			if (url.pathname.endsWith("/zones")) {
				const page = Number(url.searchParams.get("page"));
				return {
					data: [{ id: page, name: page === 1 ? "Example.com" : "other.org" }],
					pagination: { current_page: page, total_pages: 2 },
				};
			}
			return {
				data: [
					{
						content: "example.com.",
						id: 5,
						name: "www",
						priority: null,
						ttl: 3600,
						type: "CNAME",
					},
					{
						content: '"v=spf1 -all"',
						id: 6,
						name: "",
						priority: null,
						ttl: 3600,
						type: "TXT",
					},
					{
						content: "mail.example.com",
						id: 7,
						name: "",
						priority: 10,
						ttl: 3600,
						type: "MX",
					},
				],
				pagination: { current_page: 1, total_pages: 1 },
			};
		});
		const client = dnsimple.create({ token: "tok" });
		expect(await client.listZones()).toEqual([
			{ id: "example.com", name: "example.com" },
			{ id: "other.org", name: "other.org" },
		]);
		expect(await client.listRecords(zone)).toEqual([
			{
				content: "example.com",
				id: "5",
				name: "www.example.com",
				priority: null,
				ttl: 3600,
				type: "CNAME",
			},
			{
				content: "v=spf1 -all",
				id: "6",
				name: "example.com",
				priority: null,
				ttl: 3600,
				type: "TXT",
			},
			{
				content: "mail.example.com",
				id: "7",
				name: "example.com",
				priority: 10,
				ttl: 3600,
				type: "MX",
			},
		]);
		expect(calls.map((call) => call.url)).toEqual([
			`${API}/whoami`,
			`${API}/accounts`,
			`${API}/1010/zones?per_page=100&page=1`,
			`${API}/1010/zones?per_page=100&page=2`,
			`${API}/1010/zones/example.com/records?per_page=100&page=1`,
		]);
		expect(calls[0]?.headers.get("authorization")).toBe("Bearer tok");
	});

	test("creates, patches and deletes on the given account, a 404 on delete counts as gone", async () => {
		const calls = stubFetch((request) =>
			request.method === "DELETE"
				? { body: { message: "Record `9` not found" }, status: 404 }
				: {
						data: {
							content: "1.2.3.4",
							id: 9,
							name: "app",
							priority: null,
							ttl: 300,
							type: "A",
						},
					},
		);
		const client = dnsimple.create({ accountId: "42", token: "tok" });
		const created = await client.createRecord(zone, {
			content: "1.2.3.4",
			name: "app.example.com",
			ttl: 300,
			type: "A",
		});
		expect(created).toEqual({
			content: "1.2.3.4",
			id: "9",
			name: "app.example.com",
			priority: null,
			ttl: 300,
			type: "A",
		});
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toBe(`${API}/42/zones/example.com/records`);
		expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
			content: "1.2.3.4",
			name: "app",
			ttl: 300,
			type: "A",
		});
		await client.updateRecord(zone, created, {
			content: "5.6.7.8",
			name: "example.com",
			type: "A",
		});
		expect(calls[1]?.method).toBe("PATCH");
		expect(calls[1]?.url).toBe(`${API}/42/zones/example.com/records/9`);
		expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
			content: "5.6.7.8",
			name: "",
		});
		await client.deleteRecord(zone, created);
		expect(calls[2]?.url).toBe(`${API}/42/zones/example.com/records/9`);
	});

	test("a failed call names DNSimple's own error", async () => {
		stubFetch(() => ({
			body: {
				errors: { content: ["can't be blank"] },
				message: "Validation failed",
			},
			status: 400,
		}));
		await expect(
			dnsimple.create({ accountId: "1", token: "tok" }).listZones(),
		).rejects.toThrow(
			"DNSimple 400: Validation failed; content can't be blank",
		);
	});
});
