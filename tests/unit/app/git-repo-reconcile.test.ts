import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { GitRepoReconcileService } =
	await import("../../../src/lib/services/git-repo-reconcile.service");
const { GitProviderService } =
	await import("../../../src/lib/services/git-provider.service");
const { GitConnectionDTO } =
	await import("../../../src/lib/dto/git-connection-dto");
const { RepositoryDTO } = await import("../../../src/lib/dto/repository-dto");
const { ServiceGitDTO } = await import("../../../src/lib/dto/service-git-dto");
const { InstanceSettingsDTO } =
	await import("../../../src/lib/dto/instance-settings-dto");
const { GitRepoReconcileScheduler } =
	await import("../../../src/lib/services/cron/git-repo-reconcile-scheduler");

interface ServiceRow {
	gitProviderId: string;
	gitRepo: string;
	gitRepoId: string | null;
	gitUrl: string | null;
	userId: string;
}

interface RepositoryRow {
	fullName: string;
	id: string;
	providerId: string;
	providerRepoId: string | null;
	userId: string;
	webUrl: string;
}

function fakeService(row: ServiceRow) {
	return {
		toJSON: () => row,
		update: async (patch: Partial<ServiceRow>) => {
			Object.assign(row, patch);
		},
	};
}

function fakeRepository(row: RepositoryRow) {
	return {
		get fullName() {
			return row.fullName;
		},
		get id() {
			return row.id;
		},
		get providerId() {
			return row.providerId;
		},
		get userId() {
			return row.userId;
		},
		get webUrl() {
			return row.webUrl;
		},
		toJSON: () => row,
		update: async (patch: Partial<RepositoryRow>) => {
			Object.assign(row, patch);
		},
	};
}

const connection = {
	id: "conn-1",
	providerId: "gh",
	providerUsername: "ada",
	update: async (patch: { providerUsername: string }) => {
		connection.providerUsername = patch.providerUsername;
	},
};

let services: ServiceRow[] = [];
let repositories: RepositoryRow[] = [];
let answers: Record<string, unknown> = {};
let visible: { fullName: string }[] = [];
let calls: string[] = [];

beforeEach(() => {
	connection.providerUsername = "ada";
	services = [];
	repositories = [];
	answers = {};
	visible = [];
	calls = [];
	stub(InstanceSettingsDTO, "get", async () => ({
		gitProviders: [{ enabled: true, id: "gh", kind: "github", name: "GitHub" }],
	}));
	stub(GitConnectionDTO, "listAll", async () => [connection]);
	stub(GitConnectionDTO, "getForUserAndProvider", async (userId: string) =>
		userId === "owner" ? connection : null,
	);
	stub(ServiceGitDTO, "listFromProviderRepos", async () =>
		services.map(fakeService),
	);
	stub(RepositoryDTO, "list", async () => repositories.map(fakeRepository));
	stub(
		RepositoryDTO,
		"getByPath",
		async (_providerId: string, fullName: string) =>
			repositories.find((repo) => repo.fullName === fullName) ?? null,
	);
	stub(GitProviderService, "accountName", async () => "grace");
	stub(GitProviderService, "listRepos", async () => visible);
	stub(
		GitProviderService,
		"api",
		async (_provider: unknown, _connection: unknown, path: string) => {
			calls.push(path);
			if (!(path in answers)) {
				throw new Error("GitHub answered 404: Not Found");
			}
			return Response.json(answers[path]);
		},
	);
});

afterEach(restoreStubs);

describe("GitRepoReconcileService", () => {
	test("follows a repository by its id once its owner is renamed, on every service and watched repository", async () => {
		services = [
			{
				gitProviderId: "gh",
				gitRepo: "ada/app",
				gitRepoId: "42",
				gitUrl: "https://github.com/ada/app.git",
				userId: "owner",
			},
			{
				gitProviderId: "gh",
				gitRepo: "ada/app",
				gitRepoId: "42",
				gitUrl: "https://github.com/ada/app.git",
				userId: "teammate",
			},
		];
		repositories = [
			{
				fullName: "ada/app",
				id: "repo-1",
				providerId: "gh",
				providerRepoId: null,
				userId: "owner",
				webUrl: "https://github.com/ada/app",
			},
		];
		answers = { "/repositories/42": { full_name: "grace/app", id: 42 } };
		await GitRepoReconcileService.reconcileAll();
		expect(calls).toEqual(["/repositories/42"]);
		expect(services.map((row) => [row.gitRepo, row.gitUrl])).toEqual([
			["grace/app", "https://github.com/grace/app.git"],
			["grace/app", "https://github.com/grace/app.git"],
		]);
		expect(repositories[0]).toMatchObject({
			fullName: "grace/app",
			providerRepoId: "42",
			webUrl: "https://github.com/grace/app",
		});
		expect(connection.providerUsername).toBe("grace");
	});

	test("learns the id of a repository still where it was without moving it, then reads it by id", async () => {
		services = [
			{
				gitProviderId: "gh",
				gitRepo: "ada/app",
				gitRepoId: null,
				gitUrl: "https://github.com/ada/app.git",
				userId: "owner",
			},
		];
		answers = {
			"/repos/ada/app": { full_name: "ada/app", id: 42 },
			"/repositories/42": { full_name: "ada/app", id: 42 },
		};
		await GitRepoReconcileService.reconcileAll();
		expect(services[0]).toMatchObject({ gitRepo: "ada/app", gitRepoId: "42" });
		await GitRepoReconcileService.reconcileAll();
		expect(calls).toEqual(["/repos/ada/app", "/repositories/42"]);
	});

	test("finds a repository with no id by its name once its old path is gone, only when one repository matches", async () => {
		services = [
			{
				gitProviderId: "gh",
				gitRepo: "ada/app",
				gitRepoId: null,
				gitUrl: "https://github.com/ada/app.git",
				userId: "owner",
			},
		];
		visible = [{ fullName: "grace/App" }, { fullName: "grace/other" }];
		answers = { "/repos/grace/App": { full_name: "grace/App", id: 42 } };
		await GitRepoReconcileService.reconcileAll();
		expect(services[0]).toMatchObject({
			gitRepo: "grace/App",
			gitRepoId: "42",
			gitUrl: "https://github.com/grace/App.git",
		});

		services[0] = { ...services[0], gitRepo: "ada/app", gitRepoId: null };
		visible = [{ fullName: "grace/app" }, { fullName: "bob/app" }];
		await GitRepoReconcileService.reconcileAll();
		expect(services[0].gitRepo).toBe("ada/app");
	});

	test("leaves a watched repository alone when its new path is already watched, and anything nobody can read", async () => {
		repositories = [
			{
				fullName: "ada/app",
				id: "repo-1",
				providerId: "gh",
				providerRepoId: "42",
				userId: "owner",
				webUrl: "https://github.com/ada/app",
			},
			{
				fullName: "grace/app",
				id: "repo-2",
				providerId: "gh",
				providerRepoId: null,
				userId: "owner",
				webUrl: "https://github.com/grace/app",
			},
			{
				fullName: "bob/tool",
				id: "repo-3",
				providerId: "gh",
				providerRepoId: null,
				userId: "stranger",
				webUrl: "https://github.com/bob/tool",
			},
		];
		answers = {
			"/repos/grace/app": { full_name: "grace/app", id: 42 },
			"/repositories/42": { full_name: "grace/app", id: 42 },
		};
		await GitRepoReconcileService.reconcileAll();
		expect(repositories.map((repo) => repo.fullName)).toEqual([
			"ada/app",
			"grace/app",
			"bob/tool",
		]);
		expect(calls).not.toContain("/repos/bob/tool");
	});

	test("one repository the provider refuses doesn't stop the others", async () => {
		services = [
			{
				gitProviderId: "gh",
				gitRepo: "ada/secret",
				gitRepoId: "1",
				gitUrl: null,
				userId: "owner",
			},
			{
				gitProviderId: "gh",
				gitRepo: "ada/app",
				gitRepoId: "42",
				gitUrl: null,
				userId: "owner",
			},
		];
		answers = { "/repositories/42": { full_name: "grace/app", id: 42 } };
		stub(
			GitProviderService,
			"api",
			async (_provider: unknown, _connection: unknown, path: string) => {
				if (path === "/repositories/1") {
					throw new Error("GitHub refused the request (403)");
				}
				return Response.json(answers[path]);
			},
		);
		stub(GitProviderService, "accountName", async () => {
			throw new Error("offline");
		});
		await GitRepoReconcileService.reconcileAll();
		expect(services.map((row) => row.gitRepo)).toEqual([
			"ada/secret",
			"grace/app",
		]);
		expect(connection.providerUsername).toBe("ada");
	});

	test("the hourly scheduler runs a pass", async () => {
		const passes: string[] = [];
		stub(GitRepoReconcileService, "reconcileAll", async () => {
			passes.push("pass");
		});
		const scheduler = new GitRepoReconcileScheduler() as unknown as {
			tick(): Promise<void>;
		};
		await scheduler.tick();
		expect(passes).toEqual(["pass"]);
	});
});
