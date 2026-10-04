import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { ServiceDTO as ServiceRow } from "../../../src/lib/dto/service-dto";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { db } = await import("../../../src/lib/server/db/lib");
const { Logger } = await import("../../../src/lib/logger");
const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");
const { ServiceGitDTO } = await import("../../../src/lib/dto/service-git-dto");
const { DeploymentService } = await import(
	"../../../src/lib/services/deploy.service"
);
const { StatusCheckService } = await import(
	"../../../src/lib/services/status-check.service"
);
const { GitPollScheduler } = await import(
	"../../../src/lib/services/cron/git-poll-scheduler"
);

function fakeService(overrides: Record<string, unknown>) {
	const updates: Record<string, unknown>[] = [];
	const svc = {
		authAllowedEmails: [],
		authAllowedGroups: [],
		authAllowedUserIds: [],
		authProviders: [],
		buildSource: "git",
		channelBranch: null,
		channelCanary: false,
		channelCanaryDomain: null,
		channelsEnabled: false,
		dnsResolvable: false,
		domains: [],
		gitLastSeenCommit: "old",
		gitRef: "main",
		gitUrl: "https://github.com/acme/web.git",
		previewParentId: null,
		slug: "web",
		stackId: null,
		toJSON() {
			return this;
		},
		async update(patch: Record<string, unknown>) {
			updates.push(patch);
			Object.assign(svc, patch);
		},
		userId: "owner",
		...overrides,
	};
	return { svc: svc as unknown as ServiceRow, updates };
}

let polled: string[] = [];
let heads: Record<string, string> = {};
let enqueued: { svc: { id: string }; trigger: string; userId: string }[] = [];

beforeEach(() => {
	polled = [];
	heads = {};
	enqueued = [];
	stub(Logger.prototype, "info", () => undefined);
	stub(Logger.prototype, "warn", () => undefined);
	stub(StatusCheckService, "clientFor", async () => ({
		resolveCommit: async (branch: string) => {
			polled.push(branch);
			return heads[branch] ?? "old";
		},
	}));
	stub(
		DeploymentService,
		"enqueueDeploy",
		async (input: { svc: { id: string }; trigger: string; userId: string }) => {
			enqueued.push(input);
			return { deploymentId: "d1", jobId: "j1" };
		},
	);
});

afterEach(() => {
	restoreStubs();
});

async function tick(services: ServiceRow[]) {
	stub(ServiceGitDTO, "listPushPollable", async () => services);
	const scheduler = new GitPollScheduler() as unknown as {
		tick(): Promise<void>;
	};
	await scheduler.tick();
}

describe("GitPollScheduler with release channels", () => {
	test("the pollable query leaves out a parent with channels on but keeps its canary", async () => {
		let condition: SQL | undefined;
		stub(db, "select", () => ({
			from: () => ({
				where: async (where: SQL) => {
					condition = where;
					return [];
				},
			}),
		}));
		await ServiceGitDTO.listPushPollable();
		const query = new PgDialect().sqlToQuery(condition as SQL);
		expect(query.sql).toContain('"service"."channels_enabled" = $');
		expect(query.sql).toMatch(
			/\("service"\."preview_parent_id" is null or "service"\."channel_canary" = \$\d+\)/,
		);
		const channelsParam =
			query.params[
				Number(/"channels_enabled" = \$(\d+)/.exec(query.sql)?.[1]) - 1
			];
		expect(channelsParam).toBe(false);
	});

	test("a canary is polled on the canary branch and a new commit deploys it through its parent", async () => {
		const { svc: parent } = fakeService({
			channelBranch: "develop",
			channelsEnabled: true,
			id: "parent",
			userId: "owner",
		});
		const { svc: canary, updates } = fakeService({
			channelCanary: true,
			gitRef: "develop",
			id: "canary",
			previewParentId: "parent",
			slug: "web-canary",
		});
		stub(ServiceDTO, "get", async (id: string) =>
			id === "parent" ? parent : null,
		);
		stub(ServiceGitDTO, "getCanary", async () => canary);
		heads.develop = "new";

		await tick([canary]);

		expect(polled).toEqual(["develop"]);
		expect(updates[0]).toEqual({ gitLastSeenCommit: "new" });
		expect(updates[1]).toMatchObject({ gitRef: "develop" });
		expect(enqueued).toHaveLength(1);
		expect(enqueued[0]).toMatchObject({
			svc: { id: "canary" },
			trigger: "push",
			userId: "owner",
		});
	});

	test("an unchanged canary branch deploys nothing", async () => {
		const { svc: canary, updates } = fakeService({
			channelCanary: true,
			gitRef: "develop",
			id: "canary",
			previewParentId: "parent",
		});
		await tick([canary]);
		expect(polled).toEqual(["develop"]);
		expect(updates).toHaveLength(0);
		expect(enqueued).toHaveLength(0);
	});

	test("a canary whose parent turned channels off deploys as itself", async () => {
		const { svc: parent } = fakeService({ id: "parent" });
		const { svc: canary } = fakeService({
			channelCanary: true,
			gitRef: "develop",
			id: "canary",
			previewParentId: "parent",
		});
		stub(ServiceDTO, "get", async () => parent);
		heads.develop = "new";
		await tick([canary]);
		expect(enqueued.map((e) => e.svc.id)).toEqual(["canary"]);
	});

	test("a pinned commit is skipped and an unreadable branch only logs a warning", async () => {
		const warnings: string[] = [];
		stub(Logger.prototype, "warn", (message: string) => {
			warnings.push(message);
		});
		stub(StatusCheckService, "clientFor", async () => {
			throw new Error("no provider");
		});
		const { svc: pinned } = fakeService({
			gitRef: "0123456789abcdef0123456789abcdef01234567",
			id: "pinned",
		});
		const { svc: broken } = fakeService({ id: "broken" });
		await tick([pinned, broken]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("service=broken : no provider");
		expect(enqueued).toHaveLength(0);
	});
});
