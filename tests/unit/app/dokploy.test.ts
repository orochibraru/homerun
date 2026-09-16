import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { DokployService } = await import(
	"../../../src/lib/services/dokploy.service"
);
const { dokployApplication, dokployCompose, dokployDatabase, dokployRefs } =
	await import("../../../src/lib/migrate/dokploy");
const { interpolate, parseEnvBlob, previewEntries } = await import(
	"../../../src/lib/migrate/common"
);

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

const PROJECT_ALL = [
	{
		createdAt: "2026-09-11T17:44:20.934Z",
		description: "",
		env: "",
		environments: [
			{
				applications: [
					{
						applicationId: "app-img",
						applicationStatus: "done",
						name: "Pocket ID",
					},
				],
				compose: [
					{ composeId: "cmp-1", composeStatus: "done", name: "syncthing" },
				],
				environmentId: "env-1",
				isDefault: true,
				libsql: [],
				mariadb: [],
				mongo: [],
				mysql: [],
				name: "production",
				postgres: [{ postgresId: "pg-1" }],
				redis: [],
			},
		],
		name: "Homelab",
		organizationId: "org-1",
		projectId: "proj-1",
		projectTags: [],
	},
];

const IMAGE_APP = {
	applicationId: "app-img",
	buildType: "nixpacks",
	command: null,
	dockerImage: "ghcr.io/pocket-id/pocket-id:v2",
	domains: [{ host: "auth.example.com", https: true, path: "/", port: 1411 }],
	env: 'APP_URL=https://auth.example.com\nTRUST_PROXY="true"',
	memoryLimit: null,
	mounts: [
		{
			hostPath: null,
			mountPath: "/app/data",
			type: "volume",
			volumeName: "pocket-id_data",
		},
		{
			hostPath: "/etc/localtime",
			mountPath: "/etc/localtime:ro",
			type: "bind",
			volumeName: null,
		},
	],
	name: "Pocket ID",
	ports: [],
	sourceType: "docker",
};

const GITHUB_APP = {
	applicationId: "app-git",
	branch: "main",
	buildPath: "/",
	buildType: "dockerfile",
	dockerContextPath: "",
	dockerImage: null,
	dockerfile: "./Dockerfile",
	domains: [{ host: "example.fr", port: 3000 }],
	env: "TOKEN=abc",
	github: { githubUrl: "https://github.com" },
	mounts: [],
	name: "sergios",
	owner: "acme",
	repository: "sergios",
	sourceType: "github",
};

const COMPOSE = {
	composeFile:
		"services:\n  syncthing:\n    image: lscr.io/linuxserver/syncthing:\u0024{TAG:-latest}\n    expose:\n      - 8384\n",
	composeId: "cmp-1",
	domains: [{ host: "sync.example.com", port: 8384, serviceName: "syncthing" }],
	env: "",
	name: "syncthing",
	sourceType: "raw",
};

const POSTGRES = {
	appName: "gitea-database-gvwqvz",
	databaseName: "gitea",
	databasePassword: "pw",
	databaseUser: "postgres",
	dockerImage: "postgres:17",
	env: null,
	externalPort: null,
	mounts: [
		{
			mountPath: "/var/lib/postgresql/data",
			type: "volume",
			volumeName: "gitea_postgres_data",
		},
	],
	name: "database",
	postgresId: "pg-1",
};

describe("dokployRefs", () => {
	test("walks project.all's environments, where the resources actually live", () => {
		expect(dokployRefs(PROJECT_ALL)).toEqual([
			{
				id: "app-img",
				name: "Pocket ID",
				projectName: "Homelab",
				type: "application",
			},
			{
				id: "cmp-1",
				name: "syncthing",
				projectName: "Homelab",
				type: "compose",
			},
			{ id: "pg-1", name: null, projectName: "Homelab", type: "postgres" },
		]);
	});

	test("still reads an older flat project with no environments", () => {
		expect(
			dokployRefs([{ applications: [{ applicationId: "a" }], name: "Old" }]),
		).toEqual([
			{ id: "a", name: null, projectName: "Old", type: "application" },
		]);
	});
});

describe("dokployApplication", () => {
	test("maps a docker-image app with its domain port, env and mounts", () => {
		const entry = dokployApplication(IMAGE_APP, "Auth");
		expect(entry.blocked).toBeNull();
		expect(entry.drafts).toHaveLength(1);
		expect(entry.drafts[0]).toMatchObject({
			build: null,
			containerPort: 1411,
			dnsResolvable: true,
			envVars: { APP_URL: "https://auth.example.com", TRUST_PROXY: "true" },
			image: "ghcr.io/pocket-id/pocket-id",
			slug: "pocket-id",
			tag: "v2",
			volumes: [
				{
					containerPath: "/app/data",
					kind: "volume",
					name: "pocket-id_data",
					readOnly: false,
					source: "pocket-id_data",
				},
				{
					containerPath: "/etc/localtime",
					kind: "bind",
					readOnly: true,
					source: "/etc/localtime",
				},
			],
		});
	});

	test("maps a GitHub Dockerfile app onto a git build", () => {
		const entry = dokployApplication(GITHUB_APP, "Sergios");
		expect(entry.blocked).toBeNull();
		expect(entry.drafts[0]?.build).toEqual({
			context: null,
			dockerfile: "Dockerfile",
			gitRef: "main",
			gitUrl: "https://github.com/acme/sergios",
		});
		expect(entry.drafts[0]?.containerPort).toBe(3000);
	});

	test("reads a Gitea app's host from the nested provider", () => {
		const entry = dokployApplication(
			{
				...GITHUB_APP,
				gitea: { giteaUrl: "https://git.example.com/" },
				giteaBranch: "dev",
				giteaBuildPath: "/api",
				giteaOwner: "me",
				giteaRepository: "vortex",
				sourceType: "gitea",
			},
			"Stremio",
		);
		expect(entry.drafts[0]?.build).toMatchObject({
			context: "api",
			gitRef: "dev",
			gitUrl: "https://git.example.com/me/vortex",
		});
	});

	test("blocks a build pack Homerun can't run", () => {
		const entry = dokployApplication(
			{ ...GITHUB_APP, buildType: "static" },
			"Homelab",
		);
		expect(entry.blocked).toContain("static");
		expect(entry.drafts).toEqual([]);
	});
});

describe("dokployCompose", () => {
	test("parses the stored file and applies Dokploy's domain to its service", () => {
		const entry = dokployCompose(COMPOSE, "Homelab");
		expect(entry.blocked).toBeNull();
		expect(entry.drafts[0]).toMatchObject({
			containerPort: 8384,
			dnsResolvable: true,
			image: "lscr.io/linuxserver/syncthing",
			tag: "latest",
		});
	});

	test("blocks a git-sourced stack with no stored file", () => {
		const entry = dokployCompose(
			{ ...COMPOSE, composeFile: "", sourceType: "github" },
			"Homelab",
		);
		expect(entry.blocked).toContain("no compose file");
	});
});

describe("dokployDatabase", () => {
	test("turns credentials into the image's own env vars, internal only", () => {
		const entry = dokployDatabase(POSTGRES, "postgres", "Gitea");
		expect(entry.kind).toBe("database");
		expect(entry.drafts[0]).toMatchObject({
			containerPort: 5432,
			dnsResolvable: false,
			envVars: {
				POSTGRES_DB: "gitea",
				POSTGRES_PASSWORD: "pw",
				POSTGRES_USER: "postgres",
			},
			image: "postgres",
			tag: "17",
		});
		expect(entry.drafts[0]?.volumes[0]?.source).toBe("gitea_postgres_data");
	});
});

describe("common helpers", () => {
	test("parseEnvBlob reads a .env blob and tolerates junk", () => {
		expect(parseEnvBlob('FOO=bar\n# c\nQ="x y"\nEMPTY=')).toEqual({
			EMPTY: "",
			FOO: "bar",
			Q: "x y",
		});
		expect(parseEnvBlob(null)).toEqual({});
	});

	test("interpolate fills a known var and a default, leaves unknowns", () => {
		expect(interpolate("\u0024{A} \u0024{B:-b} \u0024{C}", { A: "a" })).toBe(
			"a b \u0024{C}",
		);
	});

	test("previewEntries flags taken slugs and never carries env values", () => {
		const preview = previewEntries(
			[dokployApplication(IMAGE_APP, "Auth")],
			new Set(["pocket-id"]),
		);
		expect(preview.projects).toEqual(["Auth"]);
		expect(preview.entries[0]?.services[0]).toEqual({
			envCount: 2,
			name: "Pocket ID",
			port: 1411,
			public: true,
			slug: "pocket-id",
			slugTaken: true,
			volumeCount: 2,
		});
		expect(JSON.stringify(preview)).not.toContain("auth.example.com");
	});
});

describe("DokployService.listEntries", () => {
	function serve(routes: Record<string, unknown>, status = 200) {
		const calls: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			calls.push(`${url.pathname}${url.search}`);
			const body = routes[url.pathname];
			return new Response(JSON.stringify(body ?? {}), {
				headers: { "content-type": "application/json" },
				status: body === undefined ? 404 : status,
			});
		}) as typeof fetch;
		return calls;
	}

	test("reads project.all then each resource's .one", async () => {
		const calls = serve({
			"/api/application.one": IMAGE_APP,
			"/api/compose.one": COMPOSE,
			"/api/postgres.one": POSTGRES,
			"/api/project.all": PROJECT_ALL,
		});
		const entries = await DokployService.listEntries({
			baseUrl: "https://dokploy.test/",
			token: "t",
		});
		expect(entries.map((e) => [e.kind, e.name])).toEqual([
			["application", "Pocket ID"],
			["compose", "syncthing"],
			["database", "database"],
		]);
		expect(calls).toContain("/api/postgres.one?postgresId=pg-1");
	});

	test("only fetches the picked resources on import", async () => {
		const calls = serve({
			"/api/application.one": IMAGE_APP,
			"/api/project.all": PROJECT_ALL,
		});
		const entries = await DokployService.listEntries(
			{ baseUrl: "https://dokploy.test", token: "t" },
			new Set(["app-img"]),
		);
		expect(entries).toHaveLength(1);
		expect(calls).toEqual([
			"/api/project.all",
			"/api/application.one?applicationId=app-img",
		]);
	});

	test("names the cause on a rejected token", async () => {
		serve({ "/api/project.all": {} }, 401);
		await expect(
			DokployService.listEntries({
				baseUrl: "https://dokploy.test",
				token: "t",
			}),
		).rejects.toThrow("rejected that API token");
	});

	test("says so when the answer isn't a project list at all", async () => {
		serve({ "/api/project.all": { nope: true } });
		await expect(
			DokployService.listEntries({
				baseUrl: "https://dokploy.test",
				token: "t",
			}),
		).rejects.toThrow("didn't look like a project list");
	});
});
