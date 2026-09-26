import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import { ServiceCleanup } from "./support/cleanup";
import type { ApiClient } from "./support/client";
import { apiClient } from "./support/context";

let client: ApiClient;
let cleanup: ServiceCleanup;

beforeAll(() => {
	client = apiClient();
	cleanup = new ServiceCleanup(client);
});

afterAll(async () => {
	await cleanup.cleanupAll();
});

async function createService(
	name: string,
	envVars: Record<string, string> = {},
): Promise<{ id: string; slug: string }> {
	const created = await client.POST("/services", {
		body: {
			authRequired: false,
			autoDeployOnPush: false,
			buildSource: "image",
			capAdd: [],
			containerPort: 80,
			devices: [],
			dnsResolvable: false,
			envFiles: [],
			envVars,
			gitBuildMethod: "dockerfile",
			image: "nginx",
			labels: {},
			name,
			privileged: false,
			pullPolicy: "always",
			restartPolicy: "no",
			slug: `it-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
			tag: "alpine",
		},
	});
	const svc = expectOk(created.data, created.response);
	cleanup.track(svc.id);
	return svc;
}

describe("service dependencies", () => {
	test("set, read back with sources, and refuse loops and unknown ids", async () => {
		const db = await createService("dep-db");
		const app = await createService("dep-app", {
			DATABASE_URL: `postgres://${db.slug}:5432/app`,
		});
		const cache = await createService("dep-cache");
		const path = (serviceId: string) => ({ params: { path: { serviceId } } });

		const envOnly = await client.GET(
			"/services/{serviceId}/dependencies",
			path(app.id),
		);
		expect(expectOk(envOnly.data, envOnly.response).dependsOn).toEqual([
			{ id: db.id, name: "dep-db", slug: db.slug, source: "env" },
		]);

		const set = await client.PUT("/services/{serviceId}/dependencies", {
			...path(app.id),
			body: { dependsOn: [db.id, cache.id] },
		});
		const after = expectOk(set.data, set.response);
		expect(after.dependsOn.map((dep) => [dep.id, dep.source])).toEqual([
			[db.id, "both"],
			[cache.id, "recorded"],
		]);

		const cacheSide = await client.GET(
			"/services/{serviceId}/dependencies",
			path(cache.id),
		);
		expect(expectOk(cacheSide.data, cacheSide.response).dependedOnBy).toEqual([
			{ id: app.id, name: "dep-app", slug: app.slug, source: "recorded" },
		]);

		const loop = await client.PUT("/services/{serviceId}/dependencies", {
			...path(cache.id),
			body: { dependsOn: [app.id] },
		});
		expect(loop.response.status).toBe(400);

		const unknown = await client.PUT("/services/{serviceId}/dependencies", {
			...path(app.id),
			body: { dependsOn: ["no-such-service"] },
		});
		expect(unknown.response.status).toBe(400);

		const cleared = await client.PUT("/services/{serviceId}/dependencies", {
			...path(app.id),
			body: { dependsOn: [] },
		});
		expect(expectOk(cleared.data, cleared.response).dependsOn).toEqual([
			{ id: db.id, name: "dep-db", slug: db.slug, source: "env" },
		]);
	});
});
