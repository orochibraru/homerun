import { afterEach, describe, expect, test } from "bun:test";
import { desec } from "../../../../src/lib/services/dns-providers/desec";
import { stubFetch } from "./stub-fetch";

const zone = { id: "example.com", name: "example.com" };
const API = "https://desec.io/api/v1";

afterEach(() => stubFetch.restore());

describe("deSEC", () => {
	test("follows the Link cursor for domains and spreads rrsets into records", async () => {
		const calls = stubFetch((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/api/v1/domains/") {
				return url.searchParams.get("cursor")
					? [{ minimum_ttl: 3600, name: "other.org" }]
					: {
							body: [{ minimum_ttl: 3600, name: "Example.com" }],
							headers: {
								link: `<${API}/domains/?cursor=>; rel="first", <${API}/domains/?cursor=abc>; rel="next"`,
							},
							status: 200,
						};
			}
			return [
				{
					name: "www.example.com.",
					records: ["example.com."],
					subname: "www",
					ttl: 3600,
					type: "CNAME",
				},
				{
					name: "example.com.",
					records: ['"v=spf1 -all"', '0 issue "letsencrypt.org"'],
					subname: "",
					ttl: 3600,
					type: "TXT",
				},
			];
		});
		const client = desec.create({ token: "tok" });
		expect(await client.listZones()).toEqual([
			{ id: "example.com", name: "example.com" },
			{ id: "other.org", name: "other.org" },
		]);
		expect(calls.map((call) => call.url)).toEqual([
			`${API}/domains/?cursor=`,
			`${API}/domains/?cursor=abc`,
		]);
		expect(calls[0]?.headers.get("authorization")).toBe("Token tok");
		const records = await client.listRecords(zone);
		expect(records[0]).toEqual({
			content: "example.com",
			id: "CNAME:www.example.com:example.com",
			name: "www.example.com",
			priority: null,
			ttl: 3600,
			type: "CNAME",
		});
		expect(records[1]?.content).toBe("v=spf1 -all");
		expect(calls[2]?.url).toBe(`${API}/domains/example.com/rrsets/?cursor=`);
	});

	test("creates an rrset, patches values in place and removes one keeping the rest", async () => {
		let records: string[] | null = null;
		const calls = stubFetch((request) => {
			if (request.method === "GET") {
				return records
					? {
							name: "app.example.com.",
							records,
							subname: "app",
							ttl: 3600,
							type: "MX",
						}
					: { body: { detail: "Not found." }, status: 404 };
			}
			if (request.method === "DELETE") {
				records = null;
				return { body: undefined, status: 204 };
			}
			records = JSON.parse(request.body ?? "{}").records;
			return { records };
		});
		const client = desec.create({ token: "tok" });
		const created = await client.createRecord(zone, {
			content: "mx1.example.com",
			name: "app.example.com",
			priority: 10,
			type: "MX",
		});
		expect(created).toEqual({
			content: "mx1.example.com",
			id: "MX:app.example.com:mx1.example.com",
			name: "app.example.com",
			priority: 10,
			ttl: 3600,
			type: "MX",
		});
		expect(calls[0]?.url).toBe(`${API}/domains/example.com/rrsets/app/MX/`);
		expect(calls[1]?.method).toBe("POST");
		expect(calls[1]?.url).toBe(`${API}/domains/example.com/rrsets/`);
		expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
			records: ["10 mx1.example.com."],
			subname: "app",
			ttl: 3600,
			type: "MX",
		});
		await client.createRecord(zone, {
			content: "mx2.example.com",
			name: "app.example.com",
			priority: 20,
			type: "MX",
		});
		expect(calls[3]?.method).toBe("PATCH");
		expect(JSON.parse(calls[3]?.body ?? "{}")).toEqual({
			records: ["10 mx1.example.com.", "20 mx2.example.com."],
			ttl: 3600,
		});
		await client.updateRecord(zone, created, {
			content: "mx3.example.com",
			name: "app.example.com",
			priority: 5,
			ttl: 7200,
			type: "MX",
		});
		expect(JSON.parse(calls[5]?.body ?? "{}")).toEqual({
			records: ["5 mx3.example.com.", "20 mx2.example.com."],
			ttl: 7200,
		});
		await client.deleteRecord(zone, {
			...created,
			content: "mx2.example.com",
			priority: 20,
		});
		expect(JSON.parse(calls[7]?.body ?? "{}")).toEqual({
			records: ["5 mx3.example.com."],
			ttl: 3600,
		});
		await client.deleteRecord(zone, {
			...created,
			content: "mx3.example.com",
			priority: 5,
		});
		expect(calls[9]?.method).toBe("DELETE");
		expect(calls[9]?.url).toBe(`${API}/domains/example.com/rrsets/app/MX/`);
		await client.deleteRecord(zone, created);
		expect(calls).toHaveLength(11);
	});

	test("a failed call names deSEC's own error", async () => {
		stubFetch(() => ({
			body: { detail: "Invalid token." },
			status: 401,
		}));
		await expect(desec.create({ token: "bad" }).listZones()).rejects.toThrow(
			"deSEC 401: Invalid token.",
		);
		stubFetch(() => ({
			body: { ttl: ["Ensure this value is greater than or equal to 3600."] },
			status: 400,
		}));
		await expect(
			desec.create({ token: "tok" }).createRecord(zone, {
				content: "1.2.3.4",
				name: "example.com",
				ttl: 60,
				type: "A",
			}),
		).rejects.toThrow(
			"deSEC 400: ttl: Ensure this value is greater than or equal to 3600.",
		);
	});
});
