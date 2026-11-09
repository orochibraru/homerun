import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";

import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { config } = await import("../../../src/lib/config");
const { QueueService } =
	await import("../../../src/lib/services/queue.service");
const { PipelineService } =
	await import("../../../src/lib/services/pipeline.service");
const { webhookKeepsCurrent } =
	await import("../../../src/lib/services/cron/pipeline-sync-scheduler");
const {
	isPipelineEvent,
	pipelineWebhookRequest,
	pipelineWebhookSecret,
	pipelineWebhookUrl,
} = await import("../../../src/lib/pipelines/webhooks");

type Repo = NonNullable<Parameters<typeof PipelineService.handleWebhook>[0]>;

const BODY = JSON.stringify({ action: "completed", workflow_run: { id: 1 } });

let enqueued: Record<string, unknown>[] = [];

function repository(enabled = true, kind = "github"): Repo {
	return {
		fullName: "acme/api",
		id: "repo-1",
		providerKind: kind,
		toJSON: () => ({ pipelinesEnabled: enabled }),
		userId: "user-1",
	} as unknown as Repo;
}

function signed(event: string, body = BODY): Headers {
	const signature = createHmac(
		"sha256",
		pipelineWebhookSecret(config.auth.secret, "repo-1"),
	)
		.update(body)
		.digest("hex");
	return new Headers({
		"x-github-event": event,
		"x-hub-signature-256": `sha256=${signature}`,
	});
}

beforeEach(() => {
	enqueued = [];
	stub(QueueService, "enqueue", async (input: Record<string, unknown>) => {
		enqueued.push(input);
		return { id: "job-1" };
	});
});

afterEach(restoreStubs);

describe("pipeline webhook helpers", () => {
	test("each repository gets its own URL and secret", () => {
		expect(pipelineWebhookUrl("https://homerun.example/", "repo-1")).toBe(
			"https://homerun.example/api/v1/webhooks/pipelines/repo-1",
		);
		expect(pipelineWebhookSecret("s", "repo-1")).not.toBe(
			pipelineWebhookSecret("s", "repo-2"),
		);
	});

	test("GitHub and Gitea subscribe to workflow runs and jobs, GitLab to pipelines and jobs", () => {
		const hook = { secret: "shh", url: "https://h.example/hook" };
		expect(pipelineWebhookRequest("github", "acme/api", hook)).toEqual({
			body: {
				active: true,
				config: {
					content_type: "json",
					insecure_ssl: "0",
					secret: "shh",
					url: "https://h.example/hook",
				},
				events: ["workflow_run", "workflow_job"],
				name: "web",
			},
			method: "POST",
			path: "/repos/acme/api/hooks",
		});
		expect(pipelineWebhookRequest("gitea", "acme/api", hook).body).toEqual({
			active: true,
			config: {
				content_type: "json",
				secret: "shh",
				url: "https://h.example/hook",
			},
			events: ["workflow_run", "workflow_job"],
			type: "gitea",
		});
		expect(pipelineWebhookRequest("gitlab", "group/api", hook)).toEqual({
			body: {
				enable_ssl_verification: true,
				job_events: true,
				pipeline_events: true,
				push_events: false,
				token: "shh",
				url: "https://h.example/hook",
			},
			method: "POST",
			path: "/projects/group%2Fapi/hooks",
		});
	});

	test("only workflow and pipeline events count", () => {
		const event = (name: string, value: string) =>
			isPipelineEvent(new Headers({ [name]: value }));
		expect(event("x-github-event", "workflow_run")).toBe(true);
		expect(event("x-github-event", "workflow_job")).toBe(true);
		expect(event("x-github-event", "ping")).toBe(false);
		expect(event("x-gitea-event", "workflow_job")).toBe(true);
		expect(event("x-gitlab-event", "Pipeline Hook")).toBe(true);
		expect(event("x-gitlab-event", "Job Hook")).toBe(true);
		expect(event("x-gitlab-event", "Push Hook")).toBe(false);
	});
});

describe("PipelineService.handleWebhook", () => {
	test("a signed CI event queues a sync as whoever added the repository", async () => {
		expect(
			await PipelineService.handleWebhook(
				repository(),
				signed("workflow_run"),
				BODY,
			),
		).toEqual({ jobId: "job-1", status: "queued" });
		expect(enqueued).toMatchObject([
			{ dedupeKey: "pipeline_sync:repo-1", userId: "user-1" },
		]);
	});

	test("a bad signature, an unknown repository, a ping or syncing off queue nothing", async () => {
		const forged = signed("workflow_run");
		forged.set("x-hub-signature-256", "sha256=00");
		expect(
			await PipelineService.handleWebhook(repository(), forged, BODY),
		).toMatchObject({ code: 401, status: "rejected" });
		expect(
			await PipelineService.handleWebhook(null, signed("workflow_run"), BODY),
		).toMatchObject({ code: 404, status: "rejected" });
		expect(
			await PipelineService.handleWebhook(repository(), signed("ping"), BODY),
		).toEqual({ reason: "Not a CI event.", status: "ignored" });
		expect(
			await PipelineService.handleWebhook(
				repository(false),
				signed("workflow_job"),
				BODY,
			),
		).toEqual({ reason: "Syncing CI runs is off.", status: "ignored" });
		expect(enqueued).toEqual([]);
	});

	test("GitLab deliveries carry the secret as their token", async () => {
		const headers = new Headers({
			"x-gitlab-event": "Pipeline Hook",
			"x-gitlab-token": pipelineWebhookSecret(config.auth.secret, "repo-1"),
		});
		expect(
			await PipelineService.handleWebhook(
				repository(true, "gitlab"),
				headers,
				"{}",
			),
		).toEqual({ jobId: "job-1", status: "queued" });
	});
});

describe("webhookKeepsCurrent", () => {
	const now = new Date("2026-11-09T12:00:00Z");

	test("a registered hook synced within the hour skips the poll", () => {
		expect(
			webhookKeepsCurrent(
				{
					pipelinesSyncedAt: new Date("2026-11-09T11:30:00Z"),
					webhookId: "7",
				},
				now,
			),
		).toBe(true);
	});

	test("no hook, or an hour without a sync, polls", () => {
		expect(
			webhookKeepsCurrent(
				{
					pipelinesSyncedAt: new Date("2026-11-09T11:30:00Z"),
					webhookId: null,
				},
				now,
			),
		).toBe(false);
		expect(
			webhookKeepsCurrent(
				{
					pipelinesSyncedAt: new Date("2026-11-09T10:30:00Z"),
					webhookId: "7",
				},
				now,
			),
		).toBe(false);
		expect(
			webhookKeepsCurrent({ pipelinesSyncedAt: null, webhookId: "7" }, now),
		).toBe(false);
	});
});
