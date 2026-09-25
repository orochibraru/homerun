import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { CoolifyService } = await import(
	"../../../src/lib/services/coolify.service"
);
const {
	coolifyApplication,
	coolifyDatabase,
	coolifyEnv,
	coolifyGitUrl,
	coolifyMemoryMb,
	coolifyService,
} = await import("../../../src/lib/migrate/coolify");
const { coolifyStorages, parseDockerRunOptions } = await import(
	"../../../src/lib/migrate/coolify-runtime"
);

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

const IMAGE_APP = {
	build_pack: "dockerimage",
	docker_registry_image_name: "ghcr.io/acme/api",
	docker_registry_image_tag: "v2",
	environment_id: 1,
	fqdn: "https://api.example.com,http://www.example.com:8080/v1",
	limits_cpus: "0",
	limits_memory: "512m",
	name: "api",
	ports_exposes: "8080,9090",
	uuid: "app-img",
};

const DOCKERFILE_APP = {
	base_directory: "/backend",
	build_pack: "dockerfile",
	dockerfile_location: "/Dockerfile.prod",
	environment_id: 1,
	fqdn: null,
	git_branch: "main",
	git_repository: "acme/backend",
	name: "backend",
	ports_exposes: "3000",
	uuid: "app-git",
};

const SERVICE = {
	docker_compose_raw:
		"services:\n  ghost:\n    image: ghost:5\n    environment:\n      - url=\u0024{SERVICE_FQDN_GHOST}\n    ports:\n      - 2368:2368\n",
	environment_id: 2,
	name: "blog",
	uuid: "svc-1",
};

const DATABASE = {
	database_type: "standalone-postgresql",
	environment_id: 2,
	image: "postgres:16-alpine",
	is_public: false,
	name: "pg",
	postgres_db: "app",
	postgres_password: "secret",
	postgres_user: "app",
	uuid: "db-1",
};

describe("coolify mappers", () => {
	test("a docker image app keeps its tag, first exposed port and memory limit", () => {
		const entry = coolifyApplication(IMAGE_APP, "Acme", { KEY: "v" });
		expect(entry.blocked).toBeNull();
		expect(entry.drafts[0]).toMatchObject({
			containerPort: 8080,
			cpuLimit: null,
			dnsResolvable: true,
			domains: ["api.example.com", "www.example.com"],
			envVars: { KEY: "v" },
			image: "ghcr.io/acme/api",
			memoryLimitMb: 512,
			tag: "v2",
		});
	});

	test("a Dockerfile app becomes a git build with a relative context", () => {
		const entry = coolifyApplication(DOCKERFILE_APP, "Acme", {});
		expect(entry.drafts[0]).toMatchObject({
			build: {
				context: "backend",
				dockerfile: "Dockerfile.prod",
				gitRef: "main",
				gitUrl: "https://github.com/acme/backend",
			},
			containerPort: 3000,
			dnsResolvable: false,
		});
	});

	test("nixpacks and railpack apps import as git builds with that method", () => {
		const entry = coolifyApplication(
			{ ...DOCKERFILE_APP, build_pack: "nixpacks", build_command: "make" },
			"A",
			{},
		);
		expect(entry.blocked).toBeNull();
		expect(entry.drafts[0]?.build).toEqual({
			context: "backend",
			dockerfile: null,
			gitRef: "main",
			gitUrl: "https://github.com/acme/backend",
			method: "nixpacks",
		});
		expect(entry.summary).toContain("nixpacks");
		expect(entry.warnings.join(" ")).toContain("build commands");
		expect(
			coolifyApplication({ ...DOCKERFILE_APP, build_pack: "railpack" }, "A", {})
				.drafts[0]?.build?.method,
		).toBe("railpack");
	});

	test("a static build pack and a gitless Dockerfile are blocked with a reason", () => {
		expect(
			coolifyApplication({ ...DOCKERFILE_APP, build_pack: "static" }, "A", {})
				.blocked,
		).toContain("static");
		expect(
			coolifyApplication({ ...DOCKERFILE_APP, git_repository: null }, "A", {})
				.blocked,
		).toContain("no repository");
	});

	test("a dockercompose app reads docker_compose_raw", () => {
		const entry = coolifyApplication(
			{
				...DOCKERFILE_APP,
				build_pack: "dockercompose",
				docker_compose_raw: "services:\n  web:\n    image: nginx\n",
			},
			"A",
			{},
		);
		expect(entry.kind).toBe("compose");
		expect(entry.drafts.map((d) => d.image)).toEqual(["nginx"]);
	});

	test("a service interpolates its generated env into the compose file", () => {
		const entry = coolifyService(SERVICE, "Blog", {
			SERVICE_FQDN_GHOST: "https://blog.example.com",
		});
		expect(entry.blocked).toBeNull();
		expect(entry.drafts[0]?.envVars).toEqual({
			url: "https://blog.example.com",
		});
	});

	test("a service without a compose file is blocked", () => {
		expect(
			coolifyService({ ...SERVICE, docker_compose_raw: null }, "Blog", {})
				.blocked,
		).toContain("compose file");
	});

	test("a database maps its credentials onto the image's env", () => {
		const entry = coolifyDatabase(DATABASE, "Data");
		expect(entry.drafts[0]).toMatchObject({
			containerPort: 5432,
			dnsResolvable: false,
			envVars: {
				POSTGRES_DB: "app",
				POSTGRES_PASSWORD: "secret",
				POSTGRES_USER: "app",
			},
			image: "postgres",
			tag: "16-alpine",
		});
	});

	test("env lists drop preview values and keep empties", () => {
		expect(
			coolifyEnv([
				{ is_preview: false, key: "A", value: "1" },
				{ is_preview: true, key: "A", value: "preview" },
				{ is_preview: false, key: "B", value: null },
			]),
		).toEqual({ A: "1", B: "" });
	});

	test("memory and git url helpers", () => {
		expect(coolifyMemoryMb("0")).toBeNull();
		expect(coolifyMemoryMb("2g")).toBe(2048);
		expect(coolifyGitUrl("git@github.com:a/b.git")).toBe(
			"git@github.com:a/b.git",
		);
		expect(coolifyGitUrl("a/b")).toBe("https://github.com/a/b");
	});
});

describe("coolify runtime carry-over", () => {
	test("reads the docker run options Homerun can apply", () => {
		expect(
			parseDockerRunOptions(
				"--cap-add=net_admin --device /dev/dri --privileged -l com.example=1 --ulimit nofile=1024 --entrypoint '/bin/sh -c'",
			),
		).toEqual({
			capAdd: ["NET_ADMIN"],
			devices: ["/dev/dri"],
			entrypoint: ["/bin/sh", "-c"],
			labels: { "com.example": "1" },
			privileged: true,
			unsupported: ["--ulimit"],
		});
	});

	test("applies run options, start command and listed storage to an app", () => {
		const entry = coolifyApplication(
			{
				...IMAGE_APP,
				custom_docker_run_options: "--cap-add SYS_ADMIN --shm-size 1g",
				start_command: "npm run serve",
			},
			"Acme",
			{},
			{
				files: [{ containerPath: "/app/.npmrc", content: "x" }],
				volumes: [
					{
						containerPath: "/data",
						kind: "volume",
						name: "app-img-data",
						readOnly: false,
						source: "app-img-data",
					},
				],
			},
		);
		expect(entry.drafts[0]).toMatchObject({
			capAdd: ["SYS_ADMIN"],
			command: ["sh", "-c", "npm run serve"],
			files: [{ containerPath: "/app/.npmrc", content: "x" }],
			volumes: [{ source: "app-img-data" }],
		});
		expect(entry.warnings.join(" ")).toContain("--shm-size");
		expect(entry.warnings.join(" ")).not.toContain("persistent storage");
	});

	test("warns about storage only when the source didn't list it", () => {
		expect(
			coolifyApplication(IMAGE_APP, "Acme", {}).warnings.join(" "),
		).toContain("persistent storage");
	});

	test("reads persistent volumes, host binds, directories and files", () => {
		expect(
			coolifyStorages(
				{
					file_storages: [
						{
							content: "cfg",
							fs_path: "/data/coolify/x/app.conf",
							mount_path: "/etc/app.conf",
						},
						{
							fs_path: "/data/coolify/x/dir",
							is_directory: true,
							mount_path: "/srv",
						},
					],
					persistent_storages: [
						{ mount_path: "/data", name: "db-1-data" },
						{ host_path: "/mnt/media", mount_path: "/media", name: "media" },
					],
				},
				"api",
			),
		).toEqual({
			files: [{ containerPath: "/etc/app.conf", content: "cfg" }],
			volumes: [
				{
					containerPath: "/data",
					kind: "volume",
					name: "db-1-data",
					readOnly: false,
					source: "db-1-data",
				},
				{
					containerPath: "/media",
					kind: "bind",
					name: "api-media",
					readOnly: false,
					source: "/mnt/media",
				},
				{
					containerPath: "/srv",
					kind: "bind",
					name: "api-srv",
					readOnly: false,
					source: "/data/coolify/x/dir",
				},
			],
		});
		expect(coolifyStorages({ name: "no storage here" }, "api")).toBeNull();
		expect(coolifyStorages([], "api")).toEqual({ files: [], volumes: [] });
	});

	test("a Redis database gets its password through the start command", () => {
		const entry = coolifyDatabase(
			{
				database_type: "standalone-redis",
				image: "redis:7",
				name: "cache",
				redis_password: "pw",
				uuid: "db-r",
			},
			"Data",
			{ files: [], volumes: [] },
		);
		expect(entry.drafts[0]?.command).toEqual([
			"redis-server",
			"--requirepass",
			"pw",
		]);
		expect(entry.warnings).toEqual([]);
	});
});

describe("CoolifyService.listEntries", () => {
	function serve(routes: Record<string, unknown>, status = 200) {
		const seen: Array<{ auth: string | null; path: string }> = [];
		globalThis.fetch = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const url = new URL(String(input));
			seen.push({
				auth: new Headers(init?.headers).get("authorization"),
				path: url.pathname,
			});
			const body = routes[url.pathname];
			return new Response(JSON.stringify(body ?? { message: "Not found" }), {
				headers: { "content-type": "application/json" },
				status: body === undefined ? 404 : status,
			});
		}) as typeof fetch;
		return seen;
	}

	const ROUTES = {
		"/api/v1/applications": [IMAGE_APP, DOCKERFILE_APP],
		"/api/v1/applications/app-img/envs": [
			{ is_preview: false, key: "KEY", value: "v" },
		],
		"/api/v1/databases": [DATABASE],
		"/api/v1/projects": [
			{ id: 1, name: "Acme", uuid: "p1" },
			{ id: 2, name: "Data", uuid: "p2" },
		],
		"/api/v1/projects/p1": {
			environments: [{ id: 1, name: "production" }],
			name: "Acme",
			uuid: "p1",
		},
		"/api/v1/projects/p2": {
			environments: [{ id: 2, name: "production" }],
			name: "Data",
			uuid: "p2",
		},
		"/api/v1/services": [SERVICE],
		"/api/v1/services/svc-1/envs": [
			{ key: "SERVICE_FQDN_GHOST", value: "https://blog.example.com" },
		],
	};

	test("reads apps, services and databases with a bearer token, grouped by project", async () => {
		const seen = serve(ROUTES);
		const entries = await CoolifyService.listEntries({
			baseUrl: "https://coolify.test",
			token: "tok",
		});
		expect(entries.map((e) => [e.kind, e.name, e.projectName])).toEqual([
			["application", "api", "Acme"],
			["application", "backend", "Acme"],
			["compose", "blog", "Data"],
			["database", "pg", "Data"],
		]);
		expect(entries[0]?.drafts[0]?.envVars).toEqual({ KEY: "v" });
		expect(seen.every((call) => call.auth === "Bearer tok")).toBe(true);
	});

	test("only reads the picked entries' env on import", async () => {
		const seen = serve(ROUTES);
		const entries = await CoolifyService.listEntries(
			{ baseUrl: "https://coolify.test", token: "tok" },
			new Set(["svc-1"]),
		);
		expect(entries.map((e) => e.name)).toEqual(["blog"]);
		expect(seen.map((call) => call.path)).not.toContain(
			"/api/v1/applications/app-img/envs",
		);
	});

	test("names the cause on a rejected token", async () => {
		serve(ROUTES, 401);
		await expect(
			CoolifyService.listEntries({
				baseUrl: "https://coolify.test",
				token: "t",
			}),
		).rejects.toThrow("rejected that API token");
	});
});
