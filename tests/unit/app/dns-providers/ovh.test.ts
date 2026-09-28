import { afterEach, describe, expect, test } from "bun:test";
import { ovh, ovhClient } from "../../../../src/lib/services/dns-providers/ovh";
import { stubFetch } from "./stub-fetch";

const zone = { id: "example.com", name: "example.com" };
const credentials = {
	applicationKey: "AK",
	applicationSecret: "AS",
	consumerKey: "CK",
};
const API = "https://eu.api.ovh.com/1.0";
const now = () => (1_700_000_000 - 5) * 1000;

afterEach(() => stubFetch.restore());

describe("OVHcloud", () => {
	test("signs with $1$ SHA-1 over the server-corrected time and lists zones", async () => {
		const calls = stubFetch((request) =>
			request.url.endsWith("/auth/time")
				? 1_700_000_000
				: ["Example.com", "other.org"],
		);
		const client = ovhClient(credentials, now);
		expect(await client.listZones()).toEqual([
			{ id: "Example.com", name: "example.com" },
			{ id: "other.org", name: "other.org" },
		]);
		await client.listZones();
		expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
			`GET ${API}/auth/time`,
			`GET ${API}/domain/zone`,
			`GET ${API}/domain/zone`,
		]);
		const headers = calls[1]?.headers;
		expect(headers?.get("x-ovh-application")).toBe("AK");
		expect(headers?.get("x-ovh-consumer")).toBe("CK");
		expect(headers?.get("x-ovh-timestamp")).toBe("1700000000");
		expect(headers?.get("x-ovh-signature")).toBe(
			"$1$09deb620e4cc90d8141187a1746e56af76db079a",
		);
	});

	test("picks the endpoint and rejects an unknown one", async () => {
		const calls = stubFetch((request) =>
			request.url.endsWith("/auth/time") ? 1_700_000_000 : [],
		);
		await ovh.create({ ...credentials, endpoint: "ovh-us" }).listZones();
		expect(calls[1]?.url).toBe("https://api.us.ovhcloud.com/1.0/domain/zone");
		expect(() => ovh.create({ ...credentials, endpoint: "ovh-mars" })).toThrow(
			'Unknown OVHcloud endpoint "ovh-mars"',
		);
	});

	test("lists records one by one into the common shape", async () => {
		const records: Record<string, unknown> = {
			"1": { fieldType: "A", id: 1, subDomain: "", target: "1.2.3.4", ttl: 0 },
			"2": {
				fieldType: "MX",
				id: 2,
				subDomain: "",
				target: "10 mx1.mail.ovh.net.",
				ttl: 3600,
			},
			"3": {
				fieldType: "TXT",
				id: 3,
				subDomain: "app",
				target: '"v=spf1 -all"',
				ttl: 60,
			},
			"4": {
				fieldType: "CNAME",
				id: 4,
				subDomain: "www",
				target: "example.com.",
				ttl: 0,
			},
		};
		const calls = stubFetch((request) => {
			if (request.url.endsWith("/auth/time")) {
				return 1_700_000_000;
			}
			const id = request.url.split("/record/")[1];
			return id ? records[id] : [1, 2, 3, 4];
		});
		expect(await ovhClient(credentials, now).listRecords(zone)).toEqual([
			{
				content: "1.2.3.4",
				id: "1",
				name: "example.com",
				priority: null,
				ttl: null,
				type: "A",
			},
			{
				content: "mx1.mail.ovh.net",
				id: "2",
				name: "example.com",
				priority: 10,
				ttl: 3600,
				type: "MX",
			},
			{
				content: "v=spf1 -all",
				id: "3",
				name: "app.example.com",
				priority: null,
				ttl: 60,
				type: "TXT",
			},
			{
				content: "example.com",
				id: "4",
				name: "www.example.com",
				priority: null,
				ttl: null,
				type: "CNAME",
			},
		]);
		expect(calls[1]?.url).toBe(`${API}/domain/zone/example.com/record`);
		expect(calls[2]?.url).toBe(`${API}/domain/zone/example.com/record/1`);
	});

	test("creates, updates in place, recreates on a type change, deletes, refreshing after each", async () => {
		const calls = stubFetch((request) => {
			if (request.url.endsWith("/auth/time")) {
				return 1_700_000_000;
			}
			if (request.method === "DELETE") {
				return { body: { message: "not found" }, status: 404 };
			}
			if (request.method === "POST" && request.url.endsWith("/record")) {
				return { ...JSON.parse(request.body ?? "{}"), id: 42 };
			}
			return undefined;
		});
		const client = ovhClient(credentials, now);
		const created = await client.createRecord(zone, {
			content: "mx.example.net",
			name: "example.com",
			priority: 5,
			type: "MX",
		});
		expect(created).toEqual({
			content: "mx.example.net",
			id: "42",
			name: "example.com",
			priority: 5,
			ttl: null,
			type: "MX",
		});
		expect(calls[1]?.url).toBe(`${API}/domain/zone/example.com/record`);
		expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
			fieldType: "MX",
			subDomain: "",
			target: "5 mx.example.net.",
			ttl: 0,
		});
		expect(`${calls[2]?.method} ${calls[2]?.url}`).toBe(
			`POST ${API}/domain/zone/example.com/refresh`,
		);
		const updated = await client.updateRecord(zone, created, {
			content: "target.example.net",
			name: "app.example.com",
			priority: 5,
			ttl: 300,
			type: "MX",
		});
		expect(`${calls[3]?.method} ${calls[3]?.url}`).toBe(
			`PUT ${API}/domain/zone/example.com/record/42`,
		);
		expect(JSON.parse(calls[3]?.body ?? "{}")).toEqual({
			subDomain: "app",
			target: "5 target.example.net.",
			ttl: 300,
		});
		expect(updated.content).toBe("target.example.net");
		expect(calls[4]?.url).toEndWith("/refresh");
		await client.updateRecord(zone, created, {
			content: "hello",
			name: "app.example.com",
			type: "TXT",
		});
		expect(calls.slice(5).map((call) => call.method)).toEqual([
			"DELETE",
			"POST",
			"POST",
		]);
		await client.deleteRecord(zone, created);
		expect(`${calls.at(-2)?.method} ${calls.at(-2)?.url}`).toBe(
			`DELETE ${API}/domain/zone/example.com/record/42`,
		);
		expect(calls.at(-1)?.url).toEndWith("/refresh");
	});

	test("a failed call names OVHcloud's own message", async () => {
		stubFetch((request) =>
			request.url.endsWith("/auth/time")
				? 1_700_000_000
				: {
						body: {
							class: "Client::Forbidden",
							message: "This call has not been granted",
						},
						status: 403,
					},
		);
		await expect(ovhClient(credentials, now).listZones()).rejects.toThrow(
			"OVHcloud 403: This call has not been granted",
		);
	});
});
