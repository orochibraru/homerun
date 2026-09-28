import { afterEach, describe, expect, test } from "bun:test";
import { scaleway } from "../../../../src/lib/services/dns-providers/scaleway";
import { stubFetch } from "./stub-fetch";

const API = "https://api.scaleway.com/domain/v2beta1";
const zone = { id: "example.com", name: "example.com" };

afterEach(() => stubFetch.restore());

describe("Scaleway", () => {
	test("lists every page of zones, scoped to a project, with subdomain zones spelled out", async () => {
		const calls = stubFetch((request) =>
			new URL(request.url).searchParams.get("page") === "1"
				? {
						dns_zones: [{ domain: "Example.com", subdomain: "" }],
						total_count: 2,
					}
				: {
						dns_zones: [{ domain: "example.com", subdomain: "dev" }],
						total_count: 2,
					},
		);
		const client = scaleway.create({ projectId: "proj-1", secretKey: "sk" });
		expect(await client.listZones()).toEqual([
			{ id: "example.com", name: "example.com" },
			{ id: "dev.example.com", name: "dev.example.com" },
		]);
		expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
			`GET ${API}/dns-zones?project_id=proj-1&page=1&page_size=100`,
			`GET ${API}/dns-zones?project_id=proj-1&page=2&page_size=100`,
		]);
		expect(calls[0]?.headers.get("x-auth-token")).toBe("sk");
	});

	test("lists records with full names, bare targets and unquoted TXT", async () => {
		const calls = stubFetch(() => ({
			records: [
				{
					data: "example.com.",
					id: "r1",
					name: "app",
					priority: 0,
					ttl: 3600,
					type: "CNAME",
				},
				{
					data: "mx.example.com.",
					id: "r2",
					name: "",
					priority: 10,
					ttl: 3600,
					type: "MX",
				},
				{
					data: '"v=spf1 -all"',
					id: "r3",
					name: "",
					priority: 0,
					ttl: 300,
					type: "TXT",
				},
			],
			total_count: 3,
		}));
		expect(
			await scaleway.create({ secretKey: "sk" }).listRecords(zone),
		).toEqual([
			{
				content: "example.com",
				id: "r1",
				name: "app.example.com",
				priority: null,
				ttl: 3600,
				type: "CNAME",
			},
			{
				content: "mx.example.com",
				id: "r2",
				name: "example.com",
				priority: 10,
				ttl: 3600,
				type: "MX",
			},
			{
				content: "v=spf1 -all",
				id: "r3",
				name: "example.com",
				priority: null,
				ttl: 300,
				type: "TXT",
			},
		]);
		expect(calls[0]?.url).toBe(
			`${API}/dns-zones/example.com/records?page=1&page_size=100`,
		);
	});

	test("adds, sets and deletes through the records PATCH, and an already-gone record counts as deleted", async () => {
		const calls = stubFetch((request) => {
			const body = JSON.parse(request.body ?? "{}");
			const change = body.changes[0];
			if (change.delete) {
				return {
					body: { message: "record not found", type: "not_found" },
					status: 404,
				};
			}
			const record = (change.add ?? change.set).records[0];
			return { records: [{ ...record, id: change.set?.id ?? "new-1" }] };
		});
		const client = scaleway.create({ secretKey: "sk" });

		const mx = await client.createRecord(zone, {
			content: "mx.example.com",
			name: "example.com",
			priority: 20,
			type: "MX",
		});
		expect(mx).toEqual({
			content: "mx.example.com",
			id: "new-1",
			name: "example.com",
			priority: 20,
			ttl: 3600,
			type: "MX",
		});
		expect(calls[0]?.method).toBe("PATCH");
		expect(calls[0]?.url).toBe(`${API}/dns-zones/example.com/records`);
		expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
			changes: [
				{
					add: {
						records: [
							{
								data: "mx.example.com.",
								name: "",
								priority: 20,
								ttl: 3600,
								type: "MX",
							},
						],
					},
				},
			],
			return_all_records: false,
		});

		const txt = await client.createRecord(zone, {
			content: 'say "hi"',
			name: "_acme.example.com",
			ttl: 60,
			type: "TXT",
		});
		expect(txt.content).toBe('say "hi"');
		expect(
			JSON.parse(calls[1]?.body ?? "{}").changes[0].add.records[0],
		).toEqual({
			data: '"say \\"hi\\""',
			name: "_acme",
			priority: 0,
			ttl: 60,
			type: "TXT",
		});

		const updated = await client.updateRecord(
			zone,
			{ ...mx, id: "r2" },
			{
				content: "1.2.3.4",
				name: "app.example.com",
				type: "A",
			},
		);
		expect(updated.id).toBe("r2");
		expect(JSON.parse(calls[2]?.body ?? "{}").changes).toEqual([
			{
				set: {
					id: "r2",
					records: [
						{ data: "1.2.3.4", name: "app", priority: 0, ttl: 3600, type: "A" },
					],
				},
			},
		]);

		await client.deleteRecord(zone, updated);
		expect(JSON.parse(calls[3]?.body ?? "{}").changes).toEqual([
			{ delete: { id: "r2" } },
		]);
	});

	test("a failed call names Scaleway's own error", async () => {
		stubFetch(() => ({
			body: {
				details: [{ argument_name: "data", help_message: "must be an IPv4" }],
				message: "invalid argument(s)",
				type: "invalid_arguments",
			},
			status: 400,
		}));
		await expect(
			scaleway.create({ secretKey: "sk" }).createRecord(zone, {
				content: "nope",
				name: "app.example.com",
				type: "A",
			}),
		).rejects.toThrow(
			"Scaleway 400: invalid argument(s) (data: must be an IPv4)",
		);
	});
});
