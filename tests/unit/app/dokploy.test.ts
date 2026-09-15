import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { DokployService, dokploySlug, parseDokployEnv } = await import(
	"../../../src/lib/services/dokploy.service"
);

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("parseDokployEnv", () => {
	test("reads Dokploy's one-blob env the way a .env file reads, empties included", () => {
		expect(
			parseDokployEnv('FOO=bar\n# a comment\n\nQUOTED="hello world"\nEMPTY='),
		).toEqual({ EMPTY: "", FOO: "bar", QUOTED: "hello world" });
	});

	test("tolerates a missing or non-string blob", () => {
		expect(parseDokployEnv(null)).toEqual({});
		expect(parseDokployEnv(42)).toEqual({});
		expect(parseDokployEnv("")).toEqual({});
	});
});

describe("dokploySlug", () => {
	test("makes a Dokploy name safe to use as a Homerun slug", () => {
		expect(dokploySlug("My App!")).toBe("my-app");
		expect(dokploySlug("  --weird--  ")).toBe("weird");
		expect(dokploySlug("!!!")).toBe("service");
	});
});

describe("DokployService.listEntries", () => {
	function respondWith(body: unknown, status = 200) {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify(body), {
				headers: { "content-type": "application/json" },
				status,
			})) as typeof fetch;
	}

	test("flattens applications, databases and compose stacks out of the project tree", async () => {
		respondWith([
			{
				applications: [
					{
						applicationId: "app-1",
						applicationPort: 8080,
						dockerImage: "ghcr.io/acme/api:v2",
						env: "TOKEN=secret",
						name: "api",
					},
				],
				compose: [
					{
						composeFile: "services:\n  web:\n    image: nginx\n",
						composeId: "cmp-1",
						name: "stack",
					},
				],
				name: "Acme",
				postgres: [{ name: "db", postgresId: "pg-1" }],
			},
		]);

		const entries = await DokployService.listEntries({
			baseUrl: "https://dokploy.test",
			token: "t",
		});

		expect(entries.map((e) => [e.kind, e.name])).toEqual([
			["application", "api"],
			["compose", "stack"],
			["database", "db"],
		]);
		expect(entries[0]).toMatchObject({
			containerPort: 8080,
			envVars: { TOKEN: "secret" },
			image: "ghcr.io/acme/api:v2",
			projectName: "Acme",
		});
	});

	test("names the cause on a rejected token", async () => {
		respondWith({}, 401);
		await expect(
			DokployService.listEntries({
				baseUrl: "https://dokploy.test",
				token: "t",
			}),
		).rejects.toThrow("rejected that API token");
	});

	test("says so when the answer isn't a project list at all", async () => {
		respondWith({ nope: true });
		await expect(
			DokployService.listEntries({
				baseUrl: "https://dokploy.test",
				token: "t",
			}),
		).rejects.toThrow("didn't look like a project list");
	});
});

describe("DokployService.plan", () => {
	const entry = {
		composeFile: null,
		containerPort: 3000,
		envVars: {},
		id: "app-1",
		image: "nginx:alpine",
		kind: "application" as const,
		name: "Web",
		projectName: "Acme",
	};

	test("splits the image ref and flags a slug this instance already uses", () => {
		const plan = DokployService.plan([entry], new Set(["web"]));
		expect(plan.items[0]).toMatchObject({
			blocked: null,
			image: "nginx",
			slug: "web",
			slugTaken: true,
			tag: "alpine",
		});
		expect(plan.projects).toEqual(["Acme"]);
	});

	test("blocks what it can't recreate, with the reason", () => {
		const plan = DokployService.plan(
			[
				{ ...entry, id: "a", image: null },
				{
					...entry,
					composeFile: null,
					id: "b",
					kind: "compose" as const,
				},
			],
			new Set(),
		);
		expect(plan.items[0].blocked).toContain("Built from source");
		expect(plan.items[1].blocked).toContain("compose file");
	});

	test("counts the services inside a compose stack it can read", () => {
		const plan = DokployService.plan(
			[
				{
					...entry,
					composeFile:
						"services:\n  a:\n    image: nginx\n  b:\n    image: redis\n",
					id: "c",
					kind: "compose" as const,
				},
			],
			new Set(),
		);
		expect(plan.items[0].blocked).toBeNull();
		expect(plan.items[0].composeServiceCount).toBe(2);
	});
});
