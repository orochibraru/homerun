import { afterEach, describe, expect, test } from "bun:test";
import { porkbun } from "../../../../src/lib/services/dns-providers/porkbun";
import { stubFetch } from "./stub-fetch";

const zone = { id: "example.com", name: "example.com" };
const keys = { apikey: "pk1_a", secretapikey: "sk1_b" };

afterEach(() => stubFetch.restore());

describe("Porkbun", () => {
	test("lists every page of API-enabled domains and maps records", async () => {
		const calls = stubFetch((request) => {
			const url = new URL(request.url);
			if (url.pathname.endsWith("/domain/listAll")) {
				const start = JSON.parse(request.body ?? "{}").start;
				return {
					domains:
						start === "0"
							? [
									{ apiAccess: 1, domain: "Example.com" },
									{ apiAccess: 0, domain: "locked.org" },
								]
							: start === "2"
								? [{ apiAccess: 1, domain: "other.net" }]
								: [],
					status: "SUCCESS",
				};
			}
			return {
				records: [
					{
						content: "example.com.",
						id: "11",
						name: "www.example.com",
						prio: "0",
						ttl: "600",
						type: "CNAME",
					},
					{
						content: "mail.example.com",
						id: "12",
						name: "example.com",
						prio: "10",
						ttl: "600",
						type: "MX",
					},
				],
				status: "SUCCESS",
			};
		});
		const client = porkbun.create({ apiKey: "pk1_a", secretApiKey: "sk1_b" });
		expect(await client.listZones()).toEqual([
			{ id: "example.com", name: "example.com" },
			{ id: "other.net", name: "other.net" },
		]);
		expect(calls.map((call) => JSON.parse(call.body ?? "{}"))).toEqual([
			{ ...keys, start: "0" },
			{ ...keys, start: "2" },
			{ ...keys, start: "3" },
		]);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toBe(
			"https://api.porkbun.com/api/json/v3/domain/listAll",
		);
		expect(await client.listRecords(zone)).toEqual([
			{
				content: "example.com",
				id: "11",
				name: "www.example.com",
				priority: null,
				ttl: 600,
				type: "CNAME",
			},
			{
				content: "mail.example.com",
				id: "12",
				name: "example.com",
				priority: 10,
				ttl: 600,
				type: "MX",
			},
		]);
		expect(calls[3]?.url).toBe(
			"https://api.porkbun.com/api/json/v3/dns/retrieve/example.com",
		);
	});

	test("creates, edits and deletes by id, a 404 on delete counts as gone", async () => {
		const calls = stubFetch((request) =>
			request.url.includes("/dns/delete/")
				? { body: { message: "Not found", status: "ERROR" }, status: 404 }
				: { id: 42, status: "SUCCESS" },
		);
		const client = porkbun.create({ apiKey: "pk1_a", secretApiKey: "sk1_b" });
		const created = await client.createRecord(zone, {
			content: "mail.example.com.",
			name: "example.com",
			priority: 10,
			ttl: 600,
			type: "MX",
		});
		expect(created).toEqual({
			content: "mail.example.com",
			id: "42",
			name: "example.com",
			priority: 10,
			ttl: 600,
			type: "MX",
		});
		expect(calls[0]?.url).toBe(
			"https://api.porkbun.com/api/json/v3/dns/create/example.com",
		);
		expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
			...keys,
			content: "mail.example.com",
			name: "",
			prio: "10",
			ttl: "600",
			type: "MX",
		});
		await client.updateRecord(zone, created, {
			content: "hello",
			name: "app.example.com",
			type: "TXT",
		});
		expect(calls[1]?.url).toBe(
			"https://api.porkbun.com/api/json/v3/dns/edit/example.com/42",
		);
		expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
			...keys,
			content: "hello",
			name: "app",
			type: "TXT",
		});
		await client.deleteRecord(zone, created);
		expect(calls[2]?.url).toBe(
			"https://api.porkbun.com/api/json/v3/dns/delete/example.com/42",
		);
	});

	test("a failed call names Porkbun's own error", async () => {
		stubFetch(() => ({
			body: { message: "Invalid API key. (002)", status: "ERROR" },
			status: 400,
		}));
		await expect(
			porkbun.create({ apiKey: "x", secretApiKey: "y" }).listZones(),
		).rejects.toThrow("Porkbun 400: Invalid API key. (002)");
	});
});
