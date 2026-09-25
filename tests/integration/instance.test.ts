import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import type { ApiClient } from "./support/client";
import { nativeFetch } from "./support/config";
import { apiClient, integrationContext } from "./support/context";

let client: ApiClient;
beforeAll(() => {
	client = apiClient();
});
afterAll(async () => {
	await client.PATCH("/instance/update/channel", {
		body: { channel: "stable" },
	});
});

describe("instance update channel", () => {
	test("switches to canary and back, and the status reports it", async () => {
		const canary = await client.PATCH("/instance/update/channel", {
			body: { channel: "canary" },
		});
		expect(expectOk(canary.data, canary.response).channel).toBe("canary");

		const status = await client.GET("/instance/update");
		expect(expectOk(status.data, status.response).channel).toBe("canary");

		const stable = await client.PATCH("/instance/update/channel", {
			body: { channel: "stable" },
		});
		expect(expectOk(stable.data, stable.response).channel).toBe("stable");
	});

	test("refuses an unknown channel", async () => {
		const res = await client.PATCH("/instance/update/channel", {
			body: { channel: "nightly" as "canary" },
		});
		expect(res.response.status).toBe(400);
	});
});

describe("readiness", () => {
	test("/api/v1/ready answers ok without credentials once auth and the database work", async () => {
		const res = await nativeFetch(
			`${integrationContext().origin}/api/v1/ready`,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});
});
