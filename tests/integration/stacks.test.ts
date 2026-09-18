import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import type { ApiClient } from "./support/client";
import { apiClient, integrationContext } from "./support/context";
import { StackCleanup } from "./support/stacks";

let client: ApiClient;
let cleanup: StackCleanup;
beforeAll(() => {
	client = apiClient();
	const ctx = integrationContext();
	cleanup = new StackCleanup(ctx.origin, ctx.apiKey);
});

afterAll(async () => {
	await cleanup.cleanupAll();
});

function slug(name: string): string {
	return `it-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

describe("stacks", () => {
	test("create then appears in list", async () => {
		const s = slug("stack");
		const created = await client.POST("/stacks", {
			body: {
				description: "an integration test stack",
				name: "IT Stack",
				slug: s,
			},
		});
		const stack = expectOk(created.data, created.response);
		cleanup.track(stack.id);
		expect(created.response.status).toBe(201);
		expect(stack.slug).toBe(s);

		const listed = await client.GET("/stacks");
		const stacks = expectOk(listed.data, listed.response) as { id: string }[];
		expect(stacks.some((p) => p.id === stack.id)).toBe(true);
	});

	test("duplicate slug is rejected", async () => {
		const s = slug("dup");
		const first = await client.POST("/stacks", {
			body: { name: "First", slug: s },
		});
		const firstStack = expectOk(first.data, first.response);
		cleanup.track(firstStack.id);
		const second = await client.POST("/stacks", {
			body: { name: "Second", slug: s },
		});
		expect(second.response.status).toBe(409);
	});
});
