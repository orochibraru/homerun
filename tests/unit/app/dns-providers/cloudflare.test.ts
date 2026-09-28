import { afterEach, describe, expect, test } from "bun:test";
import { cloudflare } from "../../../../src/lib/services/dns-providers/cloudflare";
import { stubFetch } from "./stub-fetch";

const zone = { id: "z1", name: "example.com" };

afterEach(() => stubFetch.restore());

describe("Cloudflare", () => {
	test("lists every page of zones and records in the common shape", async () => {
		const calls = stubFetch((request) => {
			const url = new URL(request.url);
			if (url.pathname.endsWith("/zones")) {
				const page = url.searchParams.get("page");
				return {
					result: [
						{
							id: `z${page}`,
							name: page === "1" ? "Example.com" : "other.org",
						},
					],
					result_info: { page: Number(page), total_pages: 2 },
					success: true,
				};
			}
			return {
				result: [
					{
						content: "example.com",
						id: "r1",
						name: "app.example.com",
						ttl: 1,
						type: "CNAME",
					},
				],
				result_info: { page: 1, total_pages: 1 },
				success: true,
			};
		});
		const client = cloudflare.create({ apiToken: "tok" });
		expect(await client.listZones()).toEqual([
			{ id: "z1", name: "example.com" },
			{ id: "z2", name: "other.org" },
		]);
		expect(await client.listRecords(zone)).toEqual([
			{
				content: "example.com",
				id: "r1",
				name: "app.example.com",
				priority: null,
				ttl: null,
				type: "CNAME",
			},
		]);
		expect(calls[0]?.headers.get("authorization")).toBe("Bearer tok");
	});

	test("creates with a comment, patches without, and a 404 on delete counts as gone", async () => {
		const calls = stubFetch((request) =>
			request.method === "DELETE"
				? {
						status: 404,
						body: {
							errors: [{ code: 81044, message: "Record not found" }],
							success: false,
						},
					}
				: {
						result: {
							content: "1.2.3.4",
							id: "r9",
							name: "app.example.com",
							ttl: 300,
							type: "A",
						},
						success: true,
					},
		);
		const client = cloudflare.create({ apiToken: "tok" });
		const created = await client.createRecord(zone, {
			content: "1.2.3.4",
			name: "app.example.com",
			ttl: 300,
			type: "A",
		});
		expect(created.id).toBe("r9");
		expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
			comment: "Managed by Homerun",
			content: "1.2.3.4",
			name: "app.example.com",
			ttl: 300,
			type: "A",
		});
		await client.updateRecord(zone, created, {
			content: "5.6.7.8",
			name: "app.example.com",
			type: "A",
		});
		expect(calls[1]?.method).toBe("PATCH");
		expect(JSON.parse(calls[1]?.body ?? "{}").comment).toBeUndefined();
		await client.deleteRecord(zone, created);
	});

	test("a failed call names Cloudflare's own error", async () => {
		stubFetch(() => ({
			body: {
				errors: [{ code: 9109, message: "Invalid access token" }],
				success: false,
			},
			status: 403,
		}));
		await expect(
			cloudflare.create({ apiToken: "bad" }).listZones(),
		).rejects.toThrow("Cloudflare 403: [9109] Invalid access token");
	});
});
