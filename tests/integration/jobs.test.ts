import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { expectOk } from "./support/assert";
import type { ApiClient } from "./support/client";
import { apiClient, integrationContext } from "./support/context";

const QUEUED_DEPLOY = "it-jobs-queued-deploy";
const LEASED = "it-jobs-leased-execution";
const ORPHAN = "it-jobs-orphan";
const NO_PROGRESS = "it-jobs-no-progress";

let client: ApiClient;
let sql: SQL;

beforeAll(async () => {
	client = apiClient();
	const { databaseUrl, userId } = integrationContext();
	sql = new SQL(databaseUrl);
	await sql`
		insert into job (id, type, status, stage, payload, title, user_id, created_at, run_at, started_at, worker_id, heartbeat_at, attempts)
		values
			(${QUEUED_DEPLOY}, 'deploy', 'queued', null, '{}'::jsonb, 'Deploy nothing', ${userId},
				now() at time zone 'utc', now() at time zone 'utc' + interval '1 day', null, null, null, 0),
			(${LEASED}, 'backup', 'running', 'execute', '{}'::jsonb, 'Back up nothing', ${userId},
				now() at time zone 'utc', now() at time zone 'utc', now() at time zone 'utc', 'it-ghost-worker',
				now() at time zone 'utc' + interval '1 day', 1),
			(${ORPHAN}, 'notification_delivery', 'running', null, '{}'::jsonb, 'Deliver nothing', ${userId},
				now() at time zone 'utc', now() at time zone 'utc', now() at time zone 'utc' - interval '10 minutes', null, null, 1)`;
	await sql`
		insert into job (id, type, status, stage, payload, title, user_id, created_at, run_at, started_at, worker_id, heartbeat_at, progress_at, attempts)
		values (${NO_PROGRESS}, 'backup', 'running', 'execute', '{}'::jsonb, 'Back up a wedged volume', ${userId},
			now() at time zone 'utc', now() at time zone 'utc', now() at time zone 'utc', 'it-ghost-worker',
			now() at time zone 'utc' + interval '1 day', now() at time zone 'utc' - interval '20 minutes', 1)`;
});

afterAll(async () => {
	await sql`delete from job where id in (${QUEUED_DEPLOY}, ${LEASED}, ${ORPHAN}, ${NO_PROGRESS})`;
	await sql.close();
});

describe("jobs in the way of a self-update", () => {
	test("GET /instance/update lists them as preflight blockers", async () => {
		const res = await client.GET("/instance/update");
		const { preflight } = expectOk(res.data, res.response);
		expect(preflight.ready).toBe(false);
		const ids = preflight.blockers.map((entry) => entry.id);
		expect(ids).toContain(QUEUED_DEPLOY);
		expect(ids).toContain(LEASED);
		const leased = preflight.blockers.find((entry) => entry.id === LEASED);
		expect(leased).toMatchObject({
			stage: "execute",
			stale: false,
			status: "running",
			workerId: "it-ghost-worker",
		});
	});

	test("a job that still heartbeats but made no progress for 15 minutes is stale", async () => {
		const res = await client.GET("/jobs", {
			params: { query: { status: "running" } },
		});
		const jobs = expectOk(res.data, res.response);
		expect(jobs.find((entry) => entry.id === NO_PROGRESS)).toMatchObject({
			stage: "execute",
			stale: true,
		});
		expect(jobs.find((entry) => entry.id === LEASED)).toMatchObject({
			stale: false,
		});
	});

	test("GET /jobs filters by status, and refuses an unknown one", async () => {
		const res = await client.GET("/jobs", {
			params: { query: { status: "queued,running" } },
		});
		const jobs = expectOk(res.data, res.response);
		expect(
			jobs.every((entry) => ["queued", "running"].includes(entry.status)),
		).toBe(true);
		expect(jobs.map((entry) => entry.id)).toContain(QUEUED_DEPLOY);
		expect(res.response.headers.get("x-total-count")).not.toBeNull();

		const bad = await client.GET("/jobs", {
			params: { query: { status: "stuck" } },
		});
		expect(bad.response.status).toBe(400);
	});

	test("force still can't update an instance that isn't a Compose service", async () => {
		const res = await client.POST("/instance/update", {
			body: { force: true },
		});
		expect(res.response.status).toBe(409);
		expect(JSON.stringify(res.error)).not.toContain("Wait for them to finish");
	});

	test("a running job nothing in the app is working on is requeued without a restart", async () => {
		const deadline = Date.now() + 60_000;
		let status = "running";
		while (status === "running" && Date.now() < deadline) {
			await Bun.sleep(1000);
			const res = await client.GET("/jobs/{jobId}", {
				params: { path: { jobId: ORPHAN } },
			});
			status = expectOk(res.data, res.response).status;
		}
		expect(status).not.toBe("running");
	}, 90_000);
});
