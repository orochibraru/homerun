import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { config } = await import("../../../src/lib/config");
const { InstanceSettingsDTO } =
	await import("../../../src/lib/dto/instance-settings-dto");
const { GitConnectionDTO } =
	await import("../../../src/lib/dto/git-connection-dto");
const { RepositoryDTO } = await import("../../../src/lib/dto/repository-dto");
const { GitProviderService } =
	await import("../../../src/lib/services/git-provider.service");
const { PipelineService } =
	await import("../../../src/lib/services/pipeline.service");
const { PipelineWebhookService } =
	await import("../../../src/lib/services/pipeline-webhook.service");
const { PipelineSyncScheduler } =
	await import("../../../src/lib/services/cron/pipeline-sync-scheduler");

type Repo = Parameters<typeof PipelineWebhookService.register>[0];

const PROVIDER = {
	enabled: true,
	id: "gh",
	kind: "github",
	name: "GitHub",
};

let updates: Record<string, unknown>[] = [];
let origin: string | undefined;

function repository(overrides: Record<string, unknown> = {}): Repo {
	const row = {
		pipelinesEnabled: true,
		pipelinesSyncedAt: null,
		webhookError: null,
		webhookId: null,
		...overrides,
	};
	return {
		fullName: "acme/api",
		id: "repo-1",
		providerId: "gh",
		providerKind: "github",
		toJSON: () => row,
		async update(patch: Record<string, unknown>) {
			updates.push(patch);
		},
		userId: "user-1",
	} as unknown as Repo;
}

function providers(list: unknown[]): void {
	stub(InstanceSettingsDTO, "get", async () => ({ gitProviders: list }));
}

function connected(connection: unknown): void {
	stub(GitConnectionDTO, "getForUserAndProvider", async () => connection);
}

beforeEach(() => {
	updates = [];
	origin = config.auth.origin;
	config.auth.origin = "https://homerun.example.test";
});

afterEach(() => {
	config.auth.origin = origin as string;
	restoreStubs();
});

describe("PipelineWebhookService.register", () => {
	test("registers the hook as whoever added the repository and keeps its id", async () => {
		providers([PROVIDER]);
		connected({ id: "conn-1" });
		const calls: unknown[][] = [];
		stub(GitProviderService, "registerWebhook", async (...args: unknown[]) => {
			calls.push(args);
			return "hook-9";
		});
		await PipelineWebhookService.register(repository());
		expect(calls).toHaveLength(1);
		expect(calls[0]?.[3]).toBe(
			"https://homerun.example.test/api/v1/webhooks/pipelines/repo-1",
		);
		expect(updates).toEqual([{ webhookError: null, webhookId: "hook-9" }]);
	});

	test("records why it can't: no dashboard URL, provider gone, owner disconnected, provider error", async () => {
		config.auth.origin = "";
		await PipelineWebhookService.register(repository());
		providers([]);
		config.auth.origin = "https://homerun.example.test";
		await PipelineWebhookService.register(repository());
		providers([PROVIDER]);
		connected(null);
		await PipelineWebhookService.register(repository());
		connected({ id: "conn-1" });
		stub(GitProviderService, "registerWebhook", async () => {
			throw new Error("403 Resource not accessible");
		});
		await PipelineWebhookService.register(repository());
		expect(updates.map((patch) => patch.webhookId)).toEqual([
			null,
			null,
			null,
			null,
		]);
		const errors = updates.map((patch) => String(patch.webhookError));
		expect(errors[0]).toContain("Dashboard URL");
		expect(errors[1]).toContain("removed or turned off");
		expect(errors[2]).toContain("isn't connected to GitHub");
		expect(errors[3]).toBe("403 Resource not accessible");
	});
});

describe("PipelineWebhookService.remove", () => {
	test("deletes a registered hook and swallows a provider failure", async () => {
		providers([PROVIDER]);
		connected({ id: "conn-1" });
		const deleted: unknown[] = [];
		stub(
			GitProviderService,
			"deletePushWebhook",
			async (
				_provider: unknown,
				_connection: unknown,
				name: string,
				hook: string,
			) => {
				deleted.push([name, hook]);
				throw new Error("gone already");
			},
		);
		await PipelineWebhookService.remove(repository({ webhookId: "hook-9" }));
		expect(deleted).toEqual([["acme/api", "hook-9"]]);
	});

	test("does nothing without a hook, a provider or a connection", async () => {
		const deleted: unknown[] = [];
		stub(GitProviderService, "deletePushWebhook", async () => {
			deleted.push(1);
		});
		await PipelineWebhookService.remove(repository());
		providers([]);
		await PipelineWebhookService.remove(repository({ webhookId: "hook-9" }));
		providers([PROVIDER]);
		connected(null);
		await PipelineWebhookService.remove(repository({ webhookId: "hook-9" }));
		expect(deleted).toEqual([]);
	});
});

describe("PipelineWebhookService.describe", () => {
	test("says whether it's registered, why not, and how to add it by hand", () => {
		const details = PipelineWebhookService.describe(
			repository({ webhookError: "nope", webhookId: null }),
		);
		expect(details.registered).toBe(false);
		expect(details.error).toBe("nope");
		expect(details.url).toBe(
			"https://homerun.example.test/api/v1/webhooks/pipelines/repo-1",
		);
		expect(details.secret).toBe(PipelineWebhookService.secret(repository()));
		config.auth.origin = "";
		expect(PipelineWebhookService.describe(repository()).url).toBeNull();
	});
});

describe("PipelineSyncScheduler", () => {
	test("polls what no webhook keeps current, one failure not stopping the rest", async () => {
		const fresh = repository({
			pipelinesSyncedAt: new Date(),
			webhookId: "hook-1",
		});
		const stale = Object.assign(repository(), { id: "repo-2" });
		const broken = Object.assign(repository(), { id: "repo-3" });
		stub(RepositoryDTO, "listPipelinesEnabled", async () => [
			fresh,
			broken,
			stale,
		]);
		const synced: string[] = [];
		stub(PipelineService, "sync", async (repo: Repo) => {
			synced.push(repo.id);
			if (repo.id === "repo-3") {
				throw new Error("rate limited");
			}
		});
		const scheduler = new PipelineSyncScheduler() as unknown as {
			tick(): Promise<void>;
		};
		await scheduler.tick();
		expect(synced).toEqual(["repo-3", "repo-2"]);
	});
});
