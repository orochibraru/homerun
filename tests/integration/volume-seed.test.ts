import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { expectOk } from "./support/assert";
import { ServiceCleanup } from "./support/cleanup";
import type { ApiClient } from "./support/client";
import { apiClient, integrationContext } from "./support/context";

let client: ApiClient;
let cleanup: ServiceCleanup;
let sql: SQL;
const dockerVolumes: string[] = [];

/** Runs docker and returns its trimmed stdout, throwing with stderr on failure. */
function docker(...args: string[]): string {
	const run = Bun.spawnSync(["docker", ...args]);
	if (run.exitCode !== 0) {
		throw new Error(`docker ${args.join(" ")}: ${run.stderr.toString()}`);
	}
	return run.stdout.toString().trim();
}

/** Reads a file out of a volume through a throwaway container. */
function readFrom(volume: string, path: string): string {
	return docker(
		"run",
		"--rm",
		"-v",
		`${volume}:/d:ro`,
		"alpine:3",
		"cat",
		`/d/${path}`,
	);
}

beforeAll(() => {
	client = apiClient();
	cleanup = new ServiceCleanup(client);
	sql = new SQL(integrationContext().databaseUrl);
});

afterAll(async () => {
	await cleanup.cleanupAll();
	for (const name of dockerVolumes) {
		Bun.spawnSync(["docker", "volume", "rm", "-f", name]);
	}
	await sql.close();
});

describe("seeded volumes", () => {
	test("a volume with a seed is copied from it on the first deploy only", async () => {
		const { userId } = integrationContext();
		const suffix = Date.now().toString(36);
		const origin = `homerun-it-seed-origin-${suffix}`;
		const copy = `homerun-it-seed-copy-${suffix}`;
		dockerVolumes.push(origin, copy);
		docker("volume", "create", origin);
		docker(
			"run",
			"--rm",
			"-v",
			`${origin}:/d`,
			"alpine:3",
			"sh",
			"-c",
			"echo parent > /d/index.html && chown 101:101 /d/index.html",
		);

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
				envVars: {},
				gitBuildMethod: "dockerfile",
				image: "nginx",
				labels: {},
				name: `seed-${suffix}`,
				privileged: false,
				pullPolicy: "missing",
				restartPolicy: "no",
				slug: `it-seed-${suffix}`,
				tag: "alpine",
			},
		});
		const svc = expectOk(created.data, created.response);
		cleanup.track(svc.id);

		const volumeId = crypto.randomUUID();
		const now = new Date();
		await sql`insert into storage_volume (id, name, kind, source, seed_from, user_id, created_at, updated_at)
			values (${volumeId}, ${`seed-${suffix}`}, 'volume', ${copy}, ${origin}, ${userId}, ${now}, ${now})`;
		await sql`insert into service_volume (id, service_id, volume_id, container_path, read_only, created_at)
			values (${crypto.randomUUID()}, ${svc.id}, ${volumeId}, '/usr/share/nginx/html', false, ${now})`;

		const first = await client.POST("/services/{serviceId}/deploy", {
			params: { path: { serviceId: svc.id } },
		});
		expectOk(first.data, first.response);
		expect(readFrom(copy, "index.html")).toBe("parent");
		expect(
			docker(
				"run",
				"--rm",
				"-v",
				`${copy}:/d:ro`,
				"alpine:3",
				"stat",
				"-c",
				"%u",
				"/d/index.html",
			),
		).toBe("101");

		docker(
			"run",
			"--rm",
			"-v",
			`${copy}:/d`,
			"alpine:3",
			"sh",
			"-c",
			"echo preview > /d/index.html",
		);
		const second = await client.POST("/services/{serviceId}/deploy", {
			params: { path: { serviceId: svc.id } },
		});
		expectOk(second.data, second.response);
		expect(readFrom(copy, "index.html")).toBe("preview");
		expect(readFrom(origin, "index.html")).toBe("parent");
	});
});
