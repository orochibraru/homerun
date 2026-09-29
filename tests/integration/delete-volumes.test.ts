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

/** Creates a never-deployed nginx service and returns its id. */
async function createService(slug: string): Promise<string> {
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
			name: slug,
			privileged: false,
			pullPolicy: "missing",
			restartPolicy: "no",
			slug,
			tag: "alpine",
		},
	});
	const svc = expectOk(created.data, created.response);
	cleanup.track(svc.id);
	return svc.id;
}

/** Inserts a named volume row and mounts it on each of `serviceIds`. */
async function mountVolume(
	source: string,
	serviceIds: string[],
): Promise<string> {
	const volumeId = crypto.randomUUID();
	const now = new Date();
	await sql`insert into storage_volume (id, name, kind, source, user_id, created_at, updated_at)
		values (${volumeId}, ${source}, 'volume', ${source}, ${integrationContext().userId}, ${now}, ${now})`;
	for (const serviceId of serviceIds) {
		// oxlint-disable-next-line no-await-in-loop -- two rows at most
		await sql`insert into service_volume (id, service_id, volume_id, container_path, read_only, created_at)
			values (${crypto.randomUUID()}, ${serviceId}, ${volumeId}, ${`/data-${volumeId}`}, false, ${now})`;
	}
	return volumeId;
}

describe("deleting a service with its volumes", () => {
	test("removes the volumes only it mounts and keeps the shared ones", async () => {
		const suffix = Date.now().toString(36);
		const own = `homerun-it-own-${suffix}`;
		dockerVolumes.push(own);
		Bun.spawnSync(["docker", "volume", "create", own]);

		const deleted = await createService(`it-delvol-a-${suffix}`);
		const kept = await createService(`it-delvol-b-${suffix}`);
		const ownId = await mountVolume(own, [deleted]);
		const sharedId = await mountVolume(`homerun-it-shared-${suffix}`, [
			deleted,
			kept,
		]);

		const response = await client.DELETE("/services/{serviceId}", {
			params: {
				path: { serviceId: deleted },
				query: { deleteVolumes: "true" },
			},
		});
		expect(response.response.status).toBe(204);

		const rows =
			await sql`select id from storage_volume where id in (${ownId}, ${sharedId})`;
		expect(rows.map((row: { id: string }) => row.id)).toEqual([sharedId]);
		expect(
			Bun.spawnSync(["docker", "volume", "inspect", own]).exitCode,
		).not.toBe(0);
	});
});
