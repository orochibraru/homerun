import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import type { ApiClient } from "./support/client";
import { apiClient, integrationContext } from "./support/context";
import { ProjectCleanup } from "./support/projects";

let client: ApiClient;
let cleanup: ProjectCleanup;
beforeAll(() => {
	client = apiClient();
	const ctx = integrationContext();
	cleanup = new ProjectCleanup(ctx.origin, ctx.apiKey);
});

afterAll(async () => {
	await cleanup.cleanupAll();
});

function slug(name: string): string {
	return `it-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

describe("projects", () => {
	test("create then appears in list", async () => {
		const s = slug("proj");
		const created = await client.POST("/projects", {
			body: {
				description: "an integration test project",
				name: "IT Project",
				slug: s,
			},
		});
		const project = expectOk(created.data, created.response);
		cleanup.track(project.id as string);
		expect(created.response.status).toBe(201);
		expect(project.slug).toBe(s);

		const listed = await client.GET("/projects");
		const projects = expectOk(listed.data, listed.response) as { id: string }[];
		expect(projects.some((p) => p.id === project.id)).toBe(true);
	});

	test("duplicate slug is rejected", async () => {
		const s = slug("dup");
		const first = await client.POST("/projects", {
			body: { name: "First", slug: s },
		});
		const firstProject = expectOk(first.data, first.response);
		cleanup.track(firstProject.id as string);
		const second = await client.POST("/projects", {
			body: { name: "Second", slug: s },
		});
		expect(second.response.status).toBe(409);
	});
});
