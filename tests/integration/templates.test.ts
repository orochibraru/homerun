import { beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import type { ApiClient } from "./support/client";
import { apiClient } from "./support/context";

let client: ApiClient;
beforeAll(() => {
	client = apiClient();
});

describe("templates", () => {
	test("list returns the built-in seeded templates", async () => {
		const listed = await client.GET("/templates");
		const templates = expectOk(listed.data, listed.response) as {
			id: string;
			ownerId: string | null;
		}[];
		expect(templates.length).toBeGreaterThan(0);
		// seedBuiltinTemplates() seeds these with ownerId: null on every fresh
		// boot (hooks.server.ts's init()) : a real assertion the seed ran,
		// not just that the endpoint responds.
		expect(templates.some((t) => t.ownerId === null)).toBe(true);
	});
});
