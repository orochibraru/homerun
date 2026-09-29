import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { expectOk } from "./support/assert";
import { ServiceCleanup } from "./support/cleanup";
import type { ApiClient } from "./support/client";
import { nativeFetch } from "./support/config";
import { apiClient, integrationContext } from "./support/context";
import { StackCleanup } from "./support/stacks";

let client: ApiClient;
let services: ServiceCleanup;
let stacks: StackCleanup;
let sql: SQL;

beforeAll(() => {
	client = apiClient();
	const ctx = integrationContext();
	services = new ServiceCleanup(client);
	stacks = new StackCleanup(ctx.origin, ctx.apiKey);
	sql = new SQL(ctx.databaseUrl);
});

beforeAll(async () => {
	await sql`update instance_settings set onboarding_completed_at = coalesce(onboarding_completed_at, now())`;
});

afterAll(async () => {
	await services.cleanupAll();
	await stacks.cleanupAll();
	await sql.close();
});

const tag = () =>
	`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function createStack(name: string): Promise<string> {
	const created = await client.POST("/stacks", {
		body: { name, slug: `it-mon-${tag()}` },
	});
	return stacks.track(expectOk(created.data, created.response).id);
}

async function createService(name: string, stackId: string): Promise<string> {
	const created = await client.POST("/services", {
		body: {
			authRequired: false,
			autoDeployOnPush: false,
			buildSource: "image",
			capAdd: [],
			devices: [],
			dnsResolvable: false,
			envFiles: [],
			envVars: {},
			gitBuildMethod: "dockerfile",
			labels: {},
			privileged: false,
			pullPolicy: "missing",
			restartPolicy: "no",
			containerPort: 80,
			image: "nginx",
			name,
			slug: `it-mon-${tag()}`,
			stackId,
			tag: "alpine",
		},
	});
	return services.track(expectOk(created.data, created.response).id);
}

/** A page of the app as HTML, authenticated with the run's API key. */
async function page(path: string): Promise<string> {
	const ctx = integrationContext();
	const response = await nativeFetch(`${ctx.origin}${path}`, {
		headers: { "x-api-key": ctx.apiKey },
	});
	expect(response.status).toBe(200);
	return await response.text();
}

describe("monitoring", () => {
	test("a stack's monitoring sums its services and its substacks' over the recorded history", async () => {
		const parent = await createStack("Monitored parent");
		const child = await createStack("Monitored child");
		await sql`update stack set parent_id = ${parent} where id = ${child}`;
		const web = await createService("Monitored web", parent);
		const api = await createService("Monitored api", child);

		const minuteAgo = new Date(Date.now() - 60_000);
		const now = new Date();
		for (const [at, cpu] of [
			[minuteAgo, 10],
			[now, 30],
		] as const) {
			await sql`insert into stat_sample (id, service_id, cpu_percent, mem_used_mb, mem_limit_mb, created_at)
				values (${crypto.randomUUID()}, ${web}, ${cpu}, 100, 512, ${at}),
				       (${crypto.randomUUID()}, ${api}, ${cpu}, 50, 256, ${at})`;
		}
		await sql`insert into traffic_sample (id, service_id, created_at, requests, status_4xx, status_5xx, duration_ms, bytes_in, bytes_out)
			values (${crypto.randomUUID()}, ${web}, ${now}, 1200, 12, 3, 24000, 0, 1000),
			       (${crypto.randomUUID()}, ${api}, ${now}, 34, 0, 0, 3400, 0, 10)`;

		const html = await page(`/stacks/${parent}/monitoring?range=all`);
		expect(html).toContain("Covers this stack and its 1 substack");
		expect(html).toContain((1234).toLocaleString("en-US"));
		expect(html).toContain("40.0%");
		expect(html).toContain("peak 60%");
		expect(html).toContain("Monitored api");
		expect(html).toContain("Monitored child");

		const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
		await sql`insert into traffic_sample (id, service_id, created_at, requests, status_4xx, status_5xx, duration_ms, bytes_in, bytes_out)
			values (${crypto.randomUUID()}, ${web}, ${tenDaysAgo}, 583, 0, 0, 5830, 0, 10),
			       (${crypto.randomUUID()}, ${api}, ${tenDaysAgo}, 34, 0, 0, 340, 0, 10)`;
		const week = await page(`/stacks/${parent}/monitoring?range=week`);
		expect(week).toContain("changes vs the 7 days before");
		expect(week).toContain("+100.0%");

		const global = await page("/monitoring?range=all");
		expect(global).toContain("Monitored web");
		expect(global).toContain("Monitored api");
	});
});
