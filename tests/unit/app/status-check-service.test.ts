import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { InstanceSettingsDTO } = await import(
	"../../../src/lib/dto/instance-settings-dto"
);
const { GitConnectionDTO } = await import(
	"../../../src/lib/dto/git-connection-dto"
);
const { GitProviderService } = await import(
	"../../../src/lib/services/git-provider.service"
);
const { StatusCheckService } = await import(
	"../../../src/lib/services/status-check.service"
);

const SHA = "b".repeat(40);

const selfHostedGitea = {
	baseUrl: "https://git.example.com",
	enabled: true,
	id: "gitea-1",
	kind: "gitea",
};
const disabledGitLab = {
	baseUrl: "https://gitlab.internal",
	enabled: false,
	id: "gl-1",
	kind: "gitlab",
};

let providers: unknown[] = [];
let connection: unknown = null;
const connectionLookups: Array<[string, string]> = [];
const tokenRequests: unknown[] = [];

beforeEach(() => {
	providers = [selfHostedGitea, disabledGitLab];
	connection = null;
	connectionLookups.length = 0;
	tokenRequests.length = 0;
	stub(InstanceSettingsDTO, "get", async () => ({ gitProviders: providers }));
	stub(
		GitConnectionDTO,
		"getForUserAndProvider",
		async (userId: string, providerId: string) => {
			connectionLookups.push([userId, providerId]);
			return connection;
		},
	);
	stub(
		GitProviderService,
		"accessToken",
		async (provider: unknown, conn: unknown) => {
			tokenRequests.push([provider, conn]);
			return "stored-token";
		},
	);
});

afterEach(restoreStubs);

describe("StatusCheckService.targetFor", () => {
	test("uses a configured provider's base URL and the user's stored connection token", async () => {
		connection = { id: "conn-1" };

		const target = await StatusCheckService.targetFor(
			"https://git.example.com/acme/api.git",
			"user-1",
		);

		expect(target).toEqual({
			api: "https://git.example.com/api/v1",
			kind: "gitea",
			repo: "acme/api",
			token: "stored-token",
		});
		expect(connectionLookups).toEqual([["user-1", "gitea-1"]]);
		expect(tokenRequests).toEqual([[selfHostedGitea, connection]]);
	});

	test("prefers a token embedded in the URL over the stored connection", async () => {
		connection = { id: "conn-1" };

		const target = await StatusCheckService.targetFor(
			"https://x-access-token:s%40cret@git.example.com/acme/api.git",
			"user-1",
		);

		expect(target.token).toBe("s@cret");
		expect(tokenRequests).toEqual([]);
	});

	test("reads a bare username as the embedded token", async () => {
		const target = await StatusCheckService.targetFor(
			"https://pat123@github.com/acme/api.git",
			"user-1",
		);

		expect(target).toEqual({
			api: "https://api.github.com",
			kind: "github",
			repo: "acme/api",
			token: "pat123",
		});
		expect(connectionLookups).toEqual([]);
	});

	test("a well-known host with no configured provider needs no connection and has no token", async () => {
		const target = await StatusCheckService.targetFor(
			"git@gitlab.com:group/sub/api.git",
			"user-1",
		);

		expect(target).toEqual({
			api: "https://gitlab.com/api/v4",
			kind: "gitlab",
			repo: "group/sub/api",
			token: null,
		});
		expect(connectionLookups).toEqual([]);
	});

	test("a configured provider without a stored connection has no token", async () => {
		const target = await StatusCheckService.targetFor(
			"https://git.example.com/acme/api",
			"user-2",
		);

		expect(target.token).toBeNull();
		expect(connectionLookups).toEqual([["user-2", "gitea-1"]]);
		expect(tokenRequests).toEqual([]);
	});

	test("a disabled provider is ignored, so its unknown host is rejected", async () => {
		await expect(
			StatusCheckService.targetFor(
				"https://gitlab.internal/acme/api.git",
				"user-1",
			),
		).rejects.toThrow(
			"Status checks need a git provider API, and gitlab.internal isn't a configured provider. Add it under Git Providers.",
		);
	});

	test("an unparseable URL is named as-is in the error", async () => {
		await expect(
			StatusCheckService.targetFor("not a url", "user-1"),
		).rejects.toThrow(/and not a url isn't a configured provider/);
	});

	test("a URL with no repository path is rejected", async () => {
		await expect(
			StatusCheckService.targetFor("https://github.com/", "user-1"),
		).rejects.toThrow(
			"Couldn't read the repository path from https://github.com/.",
		);
	});
});

describe("StatusCheckService.checkNames", () => {
	const realFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	test("lists the sorted, distinct check names on the ref's recent commits", async () => {
		const requests: Array<{ auth: string | undefined; url: string }> = [];
		const routes: Record<string, unknown> = {
			[`/repos/acme/api/commits/${SHA}/check-runs?per_page=100&filter=latest`]:
				{
					check_runs: [
						{ conclusion: "success", name: "test", status: "completed" },
					],
				},
			[`/repos/acme/api/commits/${SHA}/status?per_page=100`]: {
				statuses: [
					{ context: "build", state: "success" },
					{ context: "test", state: "pending" },
				],
			},
			"/repos/acme/api/commits?sha=main&per_page=5": [{ sha: SHA }],
		};
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			requests.push({
				auth: new Headers(init?.headers).get("Authorization") ?? undefined,
				url,
			});
			const match = Object.entries(routes).find(([suffix]) =>
				url.endsWith(suffix),
			);
			return match
				? Response.json(match[1])
				: new Response("missing", { status: 404 });
		}) as typeof fetch;

		expect(
			await StatusCheckService.checkNames(
				"https://tok@github.com/acme/api.git",
				"main",
				"user-1",
			),
		).toEqual(["build", "test"]);
		expect(requests[0]?.url).toBe(
			"https://api.github.com/repos/acme/api/commits?sha=main&per_page=5",
		);
		expect(requests.every((request) => request.auth === "Bearer tok")).toBe(
			true,
		);
	});
});
