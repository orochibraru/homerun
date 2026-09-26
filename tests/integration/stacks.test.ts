import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import type { ApiClient } from "./support/client";
import { nativeFetch } from "./support/config";
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

describe("nested stacks", () => {
	async function moveStack(stackId: string, parentId: string) {
		const { apiKey, origin } = integrationContext();
		const res = await nativeFetch(
			`${origin}/stacks/${stackId}/settings?/move`,
			{
				body: new URLSearchParams({ parentId }),
				headers: {
					accept: "application/json",
					"content-type": "application/x-www-form-urlencoded",
					origin,
					"x-api-key": apiKey,
				},
				method: "POST",
			},
		);
		return (await res.json()) as { type: string };
	}

	async function create(name: string) {
		const created = await client.POST("/stacks", {
			body: { name, slug: slug(name.toLowerCase()) },
		});
		const stack = expectOk(created.data, created.response);
		cleanup.track(stack.id);
		return stack;
	}

	async function parentOf(id: string): Promise<string | null> {
		const listed = await client.GET("/stacks", {
			params: { query: { perPage: "100" } },
		});
		const stacks = expectOk(listed.data, listed.response) as {
			id: string;
			parentId: string | null;
		}[];
		return stacks.find((s) => s.id === id)?.parentId ?? null;
	}

	test("a stack nests under another, never under its own substack", async () => {
		const media = await create("Media");
		const vortex = await create("Vortex");
		expect((await moveStack(vortex.id, media.id)).type).toBe("success");
		expect(await parentOf(vortex.id)).toBe(media.id);

		expect((await moveStack(media.id, vortex.id)).type).toBe("failure");
		expect(await parentOf(media.id)).toBeNull();

		expect((await moveStack(vortex.id, "")).type).toBe("success");
		expect(await parentOf(vortex.id)).toBeNull();
	});
});
