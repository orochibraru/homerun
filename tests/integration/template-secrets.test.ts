import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import type { ApiClient } from "./support/client";
import { nativeFetch } from "./support/config";
import { apiClient, integrationContext } from "./support/context";

let client: ApiClient;
const created: string[] = [];

beforeAll(() => {
	client = apiClient();
});

afterAll(async () => {
	for (const slug of created) {
		const listed = await client.GET("/services", {
			params: { query: { q: slug } },
		});
		for (const svc of (listed.data ?? []) as { id: string; slug: string }[]) {
			if (svc.slug.startsWith(slug)) {
				await client.DELETE("/services/{serviceId}", {
					params: { path: { serviceId: svc.id }, query: { force: "true" } },
				});
			}
		}
	}
});

async function templateId(name: string): Promise<string> {
	const listed = await client.GET("/templates", {
		params: { query: { q: name } },
	});
	const templates = expectOk(listed.data, listed.response) as {
		id: string;
		name: string;
	}[];
	const match = templates.find((t) => t.name === name);
	if (!match) {
		throw new Error(`no ${name} template`);
	}
	return match.id;
}

async function createFromWizard(fields: [string, string][]): Promise<void> {
	const { apiKey, origin } = integrationContext();
	const res = await nativeFetch(`${origin}/services/new?/create`, {
		body: new URLSearchParams(fields),
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded",
			origin,
			"x-api-key": apiKey,
		},
		method: "POST",
	});
	const envelope = (await res.json()) as { type: string };
	expect(envelope.type).toBe("redirect");
}

async function serviceBySlug(slug: string): Promise<{
	command: string[] | null;
	envVars: Record<string, string>;
	secretEnvKeys: string[];
	slug: string;
}> {
	const listed = await client.GET("/services", {
		params: { query: { q: slug } },
	});
	const match = (
		(listed.data ?? []) as {
			command: string[] | null;
			envVars: Record<string, string>;
			secretEnvKeys: string[];
			slug: string;
		}[]
	).find((svc) => svc.slug === slug);
	if (!match) {
		throw new Error(`no service ${slug}`);
	}
	return match;
}

describe("templates' generated secrets", () => {
	test("a cache from the wizard starts with the password its form submitted", async () => {
		const slug = `secret-cache-${crypto.randomUUID().slice(0, 6)}`;
		created.push(slug);
		await createFromWizard([
			["templateId", await templateId("Redis")],
			["name", slug],
			["slug", slug],
			["image", "redis"],
			["tag", "alpine"],
			["containerPort", "6379"],
			["envKey", "REDIS_PASSWORD"],
			["envValue", "edited-in-the-form"],
		]);
		const svc = await serviceBySlug(slug);
		expect(svc.command).toEqual([
			"redis-server",
			"--requirepass",
			"edited-in-the-form",
		]);
		expect(svc.envVars.REDIS_PASSWORD).toBe("edited-in-the-form");
		expect(svc.secretEnvKeys).toEqual(["REDIS_PASSWORD"]);
	});

	test("a linked cache gets its own password, and the app's URL carries it", async () => {
		const slug = `secret-app-${crypto.randomUUID().slice(0, 6)}`;
		created.push(slug);
		await createFromWizard([
			["templateId", await templateId("Paperless-ngx")],
			["name", slug],
			["slug", slug],
			["image", "ghcr.io/paperless-ngx/paperless-ngx"],
			["tag", "latest"],
			["containerPort", "8000"],
			["envKey", "PAPERLESS_REDIS"],
			["envValue", "redis://:{{redis.REDIS_PASSWORD}}@{{redis}}:6379"],
		]);
		const app = await serviceBySlug(slug);
		const cache = await serviceBySlug(`${slug}-redis`);
		const password = cache.envVars.REDIS_PASSWORD ?? "";
		expect(password).toMatch(/^[0-9a-f]{48}$/);
		expect(cache.secretEnvKeys).toEqual(["REDIS_PASSWORD"]);
		expect(cache.command).toContain(password);
		expect(app.envVars.PAPERLESS_REDIS).toBe(
			`redis://:${password}@${cache.slug}:6379`,
		);
	});
});
