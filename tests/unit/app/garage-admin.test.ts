import { describe, expect, test } from "bun:test";

const { GarageAdminClient, toBucketInfo } = await import(
	"../../../src/lib/services/s3/garage-admin"
);

interface Call {
	body: unknown;
	method: string;
	operation: string;
	query: Record<string, string>;
}

function fakeGarage(respond: (call: Call) => Response): {
	calls: Call[];
	garage: InstanceType<typeof GarageAdminClient>;
} {
	const calls: Call[] = [];
	const fetcher = async (input: URL | RequestInfo, init?: RequestInit) => {
		const url = new URL(String(input));
		const call = {
			body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
			method: init?.method ?? "GET",
			operation: url.pathname.replace("/v2/", ""),
			query: Object.fromEntries(url.searchParams),
		};
		calls.push(call);
		return respond(call);
	};
	return {
		calls,
		garage: new GarageAdminClient(
			"http://garage:3903/",
			"token",
			fetcher as unknown as typeof fetch,
		),
	};
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status });

describe("GarageAdminClient", () => {
	test("reports health from the unauthenticated endpoint", async () => {
		const up = fakeGarage(() => new Response("", { status: 200 }));
		expect(await up.garage.healthy()).toBe(true);
		expect(up.calls[0].operation).toBe("/health");
		const down = fakeGarage(() => new Response("", { status: 503 }));
		expect(await down.garage.healthy()).toBe(false);
	});

	test("gives a fresh node a role and applies the next layout version", async () => {
		const { calls, garage } = fakeGarage((call) =>
			call.operation === "GetClusterStatus"
				? json({ layoutVersion: 2, nodes: [{ id: "node-1", role: null }] })
				: json({}),
		);
		await garage.ensureLayout(5);
		expect(calls.map((call) => call.operation)).toEqual([
			"GetClusterStatus",
			"UpdateClusterLayout",
			"ApplyClusterLayout",
		]);
		expect(calls[1].body).toEqual({
			roles: [{ capacity: 5, id: "node-1", tags: [], zone: "homerun" }],
		});
		expect(calls[2].body).toEqual({ version: 3 });
	});

	test("leaves a node that already has a role alone", async () => {
		const { calls, garage } = fakeGarage(() =>
			json({ layoutVersion: 1, nodes: [{ id: "n", role: { zone: "z" } }] }),
		);
		await garage.ensureLayout();
		expect(calls).toHaveLength(1);
	});

	test("finds a bucket by name, null on a 404", async () => {
		const { calls, garage } = fakeGarage((call) =>
			call.query.globalAlias === "missing"
				? json({ message: "Bucket not found" }, 404)
				: json({ bytes: 9, globalAliases: ["b"], id: "id-b", objects: 2 }),
		);
		expect(await garage.bucket("b")).toEqual({
			bytes: 9,
			id: "id-b",
			keys: [],
			name: "b",
			objects: 2,
		});
		expect(calls[0].method).toBe("GET");
		expect(await garage.bucket("missing")).toBeNull();
	});

	test("surfaces Garage's message on other failures", async () => {
		const { garage } = fakeGarage(() =>
			json({ code: "InvalidRequest", message: "bad alias" }, 400),
		);
		await expect(garage.createKey("k")).rejects.toThrow(
			"Garage CreateKey failed (400): bad alias",
		);
	});

	test("creates a bucket and gives the owner key full access", async () => {
		const { calls, garage } = fakeGarage((call) =>
			call.operation === "CreateBucket" ? json({ id: "new-id" }) : json({}),
		);
		await garage.createBucket("tfstate", "GKowner");
		expect(calls[0].body).toEqual({ globalAlias: "tfstate" });
		expect(calls[1]).toMatchObject({
			body: {
				accessKeyId: "GKowner",
				bucketId: "new-id",
				permissions: { owner: true, read: true, write: true },
			},
			operation: "AllowBucketKey",
		});
	});

	test("deletes only an empty bucket, and a missing one is a no-op", async () => {
		const full = fakeGarage(() => json({ id: "x", objects: 3 }));
		await expect(full.garage.deleteBucket("b")).rejects.toThrow(
			"still holds objects",
		);
		const empty = fakeGarage(() => json({ id: "x", objects: 0 }));
		await empty.garage.deleteBucket("b");
		expect(empty.calls[1]).toMatchObject({
			method: "POST",
			operation: "DeleteBucket",
			query: { id: "x" },
		});
		const gone = fakeGarage(() => json({}, 404));
		await gone.garage.deleteBucket("b");
		expect(gone.calls).toHaveLength(1);
	});

	test("lists bucket names and manages keys", async () => {
		const { calls, garage } = fakeGarage((call) => {
			if (call.operation === "ListBuckets") {
				return json([{ globalAliases: ["z"] }, { globalAliases: ["a"] }, {}]);
			}
			if (call.operation === "CreateKey") {
				return json({
					accessKeyId: "GK1",
					created: "now",
					name: "k",
					secretAccessKey: "s",
				});
			}
			return json({});
		});
		expect(await garage.bucketNames()).toEqual(["a", "z"]);
		expect(await garage.createKey("k")).toEqual({
			accessKeyId: "GK1",
			name: "k",
			secretAccessKey: "s",
		});
		await garage.deleteKey("GK1");
		expect(calls.at(-1)).toMatchObject({
			operation: "DeleteKey",
			query: { id: "GK1" },
		});
	});
});

describe("toBucketInfo", () => {
	test("fills what Garage leaves out", () => {
		expect(
			toBucketInfo(
				{
					id: "i",
					keys: [{ accessKeyId: "GK", permissions: { read: true } }],
				},
				"fallback",
			),
		).toEqual({
			bytes: 0,
			id: "i",
			keys: [
				{
					accessKeyId: "GK",
					name: "",
					permissions: { owner: false, read: true, write: false },
				},
			],
			name: "fallback",
			objects: 0,
		});
	});
});
