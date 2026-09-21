import { afterEach, describe, expect, mock, test } from "bun:test";
import type { GitConnectionDTO } from "../../../src/lib/dto/git-connection-dto";
import type { GitProviderConfig } from "../../../src/lib/server/db/schema";
import { encryptSecret } from "../../../src/lib/services/secrets";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { GitProviderRefusedError, GitProviderService } = await import(
	"../../../src/lib/services/git-provider.service"
);
const { config } = await import("../../../src/lib/config");

interface FakeRow {
	accessTokenEnc: string;
	expiresAt: Date | null;
	id: string;
	refreshTokenEnc: string | null;
}

function connection(row: FakeRow): GitConnectionDTO {
	return {
		get accessTokenEnc() {
			return row.accessTokenEnc;
		},
		get expiresAt() {
			return row.expiresAt;
		},
		get id() {
			return row.id;
		},
		get refreshTokenEnc() {
			return row.refreshTokenEnc;
		},
		update: async (input: Partial<FakeRow>) => {
			Object.assign(row, input);
		},
	} as unknown as GitConnectionDTO;
}

function providerOf(
	kind: GitProviderConfig["kind"],
	baseUrl: string | null = null,
): GitProviderConfig {
	return {
		baseUrl,
		clientId: "client",
		clientSecretEnc: encryptSecret("shh"),
		enabled: true,
		id: `${kind}-1`,
		kind,
		name: kind,
	};
}

const github = providerOf("github");
const gitlab = providerOf("gitlab");
const bitbucket = providerOf("bitbucket");
const gitea = {
	...providerOf("gitea", "https://gitea.example.com"),
	name: "Gitea",
};

function validConnection(id = "live"): GitConnectionDTO {
	return connection({
		accessTokenEnc: encryptSecret("token"),
		expiresAt: null,
		id,
		refreshTokenEnc: null,
	});
}

function undecryptable(): GitConnectionDTO {
	return connection({
		accessTokenEnc: "garbage",
		expiresAt: null,
		id: "broken",
		refreshTokenEnc: null,
	});
}

interface Call {
	init: RequestInit;
	url: string;
}

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

function stubFetch(
	respond: (url: string, init: RequestInit) => Response | Promise<Response>,
): Call[] {
	const calls: Call[] = [];
	globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
		calls.push({ init, url: String(url) });
		return await respond(String(url), init);
	}) as unknown as typeof fetch;
	return calls;
}

function headersOf(call: Call): Record<string, string> {
	return call.init.headers as Record<string, string>;
}

describe("OAuth state", () => {
	test("a freshly minted state verifies for its own provider and user only", () => {
		const state = GitProviderService.createState("p1", "u1");
		expect(GitProviderService.verifyState(state, "p1", "u1")).toBe(true);
		expect(GitProviderService.verifyState(state, "p2", "u1")).toBe(false);
		expect(GitProviderService.verifyState(state, "p1", "u2")).toBe(false);
	});

	test("a tampered signature or garbage never verifies", () => {
		const decoded = Buffer.from(
			GitProviderService.createState("p1", "u1"),
			"base64url",
		).toString("utf8");
		const forged = Buffer.from(`${decoded.slice(0, -2)}00`).toString(
			"base64url",
		);
		expect(GitProviderService.verifyState(forged, "p1", "u1")).toBe(false);
		const short = Buffer.from(decoded.slice(0, -4)).toString("base64url");
		expect(GitProviderService.verifyState(short, "p1", "u1")).toBe(false);
		expect(GitProviderService.verifyState("", "p1", "u1")).toBe(false);
		expect(GitProviderService.verifyState("!!!", "p1", "u1")).toBe(false);
	});

	test("a state older than ten minutes is rejected", () => {
		const state = GitProviderService.createState("p1", "u1");
		const realNow = Date.now;
		Date.now = () => realNow() + 11 * 60 * 1000;
		try {
			expect(GitProviderService.verifyState(state, "p1", "u1")).toBe(false);
		} finally {
			Date.now = realNow;
		}
	});
});

describe("authorizeUrl", () => {
	test("each provider kind points at its own consent screen and scope", () => {
		const cases: [GitProviderConfig, string, string][] = [
			[github, "https://github.com/login/oauth/authorize", "repo read:user"],
			[gitlab, "https://gitlab.com/oauth/authorize", "api read_user"],
			[
				providerOf("gitlab", "https://git.example.com///"),
				"https://git.example.com/oauth/authorize",
				"api read_user",
			],
			[
				gitea,
				"https://gitea.example.com/login/oauth/authorize",
				"write:repository read:user",
			],
			[
				bitbucket,
				"https://bitbucket.org/site/oauth2/authorize",
				"repository webhook account",
			],
		];
		for (const [provider, base, scope] of cases) {
			const url = new URL(
				GitProviderService.authorizeUrl(provider, "st", "https://h/cb"),
			);
			expect(`${url.origin}${url.pathname}`).toBe(base);
			expect(url.searchParams.get("scope")).toBe(scope);
			expect(url.searchParams.get("state")).toBe("st");
			expect(url.searchParams.get("client_id")).toBe("client");
			expect(url.searchParams.get("redirect_uri")).toBe("https://h/cb");
			expect(url.searchParams.get("response_type")).toBe("code");
		}
	});

	test("a Gitea provider with no base URL is refused", () => {
		expect(() =>
			GitProviderService.authorizeUrl(providerOf("gitea"), "st", "cb"),
		).toThrow("Gitea providers require a base URL.");
	});
});

describe("exchangeCode", () => {
	test("posts the client credentials as body params and labels the account", async () => {
		const calls = stubFetch((url) =>
			url.endsWith("/access_token")
				? Response.json({ access_token: "gh-token" })
				: Response.json({ login: "octocat" }),
		);

		const exchanged = await GitProviderService.exchangeCode(
			github,
			"the-code",
			"https://h/cb",
		);

		expect(exchanged).toEqual({
			accessToken: "gh-token",
			expiresAt: null,
			providerUsername: "octocat",
			refreshToken: null,
		});
		const sent = new URLSearchParams(String(calls[0].init.body));
		expect(sent.get("code")).toBe("the-code");
		expect(sent.get("grant_type")).toBe("authorization_code");
		expect(sent.get("client_secret")).toBe("shh");
		expect(calls[1].url).toBe("https://api.github.com/user");
		expect(headersOf(calls[1]).Authorization).toBe("Bearer gh-token");
	});

	test("Bitbucket authenticates with Basic auth and never sends a redirect URI", async () => {
		const calls = stubFetch((url) =>
			url.endsWith("/access_token")
				? Response.json({
						access_token: "bb-token",
						expires_in: 7200,
						refresh_token: "bb-refresh",
					})
				: Response.json({ username: "bucketeer" }),
		);

		const exchanged = await GitProviderService.exchangeCode(
			bitbucket,
			"code",
			"https://h/cb",
		);

		expect(exchanged.providerUsername).toBe("bucketeer");
		expect(exchanged.refreshToken).toBe("bb-refresh");
		expect(exchanged.expiresAt?.getTime()).toBeGreaterThan(Date.now());
		expect(headersOf(calls[0]).Authorization).toBe(
			`Basic ${Buffer.from("client:shh").toString("base64")}`,
		);
		const sent = new URLSearchParams(String(calls[0].init.body));
		expect(sent.has("redirect_uri")).toBe(false);
		expect(sent.has("client_secret")).toBe(false);
	});

	test("an account with neither login nor username is labelled unknown", async () => {
		stubFetch((url) =>
			url.endsWith("/oauth/token")
				? Response.json({ access_token: "gl" })
				: Response.json({}),
		);
		expect(
			(await GitProviderService.exchangeCode(gitlab, "c", "cb"))
				.providerUsername,
		).toBe("unknown");
	});

	test("a 200 with no access token carries the provider's error", async () => {
		stubFetch(() =>
			Response.json({
				error: "bad_verification_code",
				error_description: "The code passed is incorrect",
			}),
		);
		await expect(
			GitProviderService.exchangeCode(github, "c", "cb"),
		).rejects.toThrow(
			"Token exchange failed: bad_verification_code The code passed is incorrect",
		);
		stubFetch(() => Response.json({}));
		await expect(
			GitProviderService.exchangeCode(github, "c", "cb"),
		).rejects.toThrow("no access_token");
	});

	test("a failing user lookup fails the exchange", async () => {
		stubFetch((url) =>
			url.endsWith("/access_token")
				? Response.json({ access_token: "t" })
				: new Response("nope", { status: 500 }),
		);
		await expect(
			GitProviderService.exchangeCode(github, "c", "cb"),
		).rejects.toThrow("Couldn't fetch account info: 500");
	});
});

describe("GitProviderService.accessToken edge cases", () => {
	test("a token with no expiry is never refreshed", async () => {
		const calls = stubFetch(() => Response.json({}));
		expect(
			await GitProviderService.accessToken(github, validConnection()),
		).toBe("token");
		expect(calls).toHaveLength(0);
	});

	test("an expired token without a refresh token is returned as is", async () => {
		const calls = stubFetch(() => Response.json({}));
		const token = await GitProviderService.accessToken(
			github,
			connection({
				accessTokenEnc: encryptSecret("old"),
				expiresAt: new Date(Date.now() - 1000),
				id: "no-refresh",
				refreshTokenEnc: null,
			}),
		);
		expect(token).toBe("old");
		expect(calls).toHaveLength(0);
	});

	test("a token about to expire is refreshed, keeping a refresh token the provider didn't rotate", async () => {
		const previousOrigin = config.auth.origin;
		config.auth.origin = "https://homerun.example.com/";
		const calls = stubFetch(() =>
			Response.json({ access_token: "renewed", expires_in: 0 }),
		);
		const refreshEnc = encryptSecret("keep-me");
		const row: FakeRow = {
			accessTokenEnc: encryptSecret("expiring"),
			expiresAt: new Date(Date.now() + 30 * 1000),
			id: "margin",
			refreshTokenEnc: refreshEnc,
		};
		try {
			expect(
				await GitProviderService.accessToken(gitlab, connection(row)),
			).toBe("renewed");
		} finally {
			config.auth.origin = previousOrigin;
		}
		expect(row.refreshTokenEnc).toBe(refreshEnc);
		expect(row.expiresAt).toBeNull();
		const sent = new URLSearchParams(String(calls[0].init.body));
		expect(sent.get("redirect_uri")).toBe(
			"https://homerun.example.com/api/v1/git-providers/gitlab-1/callback",
		);
	});

	test("an undecryptable refresh token falls back to the current token", async () => {
		const calls = stubFetch(() => Response.json({ access_token: "x" }));
		const token = await GitProviderService.accessToken(
			github,
			connection({
				accessTokenEnc: encryptSecret("current"),
				expiresAt: new Date(Date.now() - 1000),
				id: "bad-refresh",
				refreshTokenEnc: "garbage",
			}),
		);
		expect(token).toBe("current");
		expect(calls).toHaveLength(0);
	});
});

describe("listRepos", () => {
	test("normalizes GitHub and Gitea repos", async () => {
		const rows = [
			{
				clone_url: "https://github.com/a/b.git",
				default_branch: "main",
				full_name: "a/b",
				private: true,
			},
		];
		const calls = stubFetch(() => Response.json(rows));
		expect(
			await GitProviderService.listRepos(github, validConnection()),
		).toEqual([
			{
				cloneUrl: "https://github.com/a/b.git",
				defaultBranch: "main",
				fullName: "a/b",
				private: true,
			},
		]);
		expect(calls[0].url).toBe(
			"https://api.github.com/user/repos?per_page=100&sort=updated",
		);
		await GitProviderService.listRepos(gitea, validConnection());
		expect(calls[1].url).toBe(
			"https://gitea.example.com/api/v1/user/repos?limit=50",
		);
	});

	test("normalizes GitLab visibility into private", async () => {
		stubFetch(() =>
			Response.json([
				{
					default_branch: "dev",
					http_url_to_repo: "https://gitlab.com/g/p.git",
					path_with_namespace: "g/p",
					visibility: "internal",
				},
				{
					default_branch: "main",
					http_url_to_repo: "https://gitlab.com/g/q.git",
					path_with_namespace: "g/q",
					visibility: "public",
				},
			]),
		);
		const repos = await GitProviderService.listRepos(gitlab, validConnection());
		expect(repos.map((r) => [r.fullName, r.private, r.defaultBranch])).toEqual([
			["g/p", true, "dev"],
			["g/q", false, "main"],
		]);
	});

	test("prefers Bitbucket's https clone link and defaults the branch to main", async () => {
		stubFetch(() =>
			Response.json({
				values: [
					{
						full_name: "t/one",
						is_private: false,
						links: {
							clone: [
								{ href: "ssh://git@bitbucket.org/t/one.git", name: "ssh" },
								{ href: "https://bitbucket.org/t/one.git", name: "https" },
							],
						},
						mainbranch: { name: "trunk" },
					},
					{
						full_name: "t/two",
						is_private: true,
						links: {
							clone: [
								{ href: "ssh://git@bitbucket.org/t/two.git", name: "ssh" },
							],
						},
					},
					{ full_name: "t/three", is_private: true, links: { clone: [] } },
				],
			}),
		);
		expect(
			await GitProviderService.listRepos(bitbucket, validConnection()),
		).toEqual([
			{
				cloneUrl: "https://bitbucket.org/t/one.git",
				defaultBranch: "trunk",
				fullName: "t/one",
				private: false,
			},
			{
				cloneUrl: "ssh://git@bitbucket.org/t/two.git",
				defaultBranch: "main",
				fullName: "t/two",
				private: true,
			},
			{
				cloneUrl: "",
				defaultBranch: "main",
				fullName: "t/three",
				private: true,
			},
		]);
	});

	test("every provider reports a failed listing with its status", async () => {
		stubFetch(() => new Response("", { status: 502 }));
		for (const provider of [github, gitlab, gitea, bitbucket]) {
			await expect(
				GitProviderService.listRepos(provider, validConnection()),
			).rejects.toThrow("Couldn't list repos: 502");
		}
	});

	test("an undecryptable access token is reported, not sent", async () => {
		const calls = stubFetch(() => Response.json([]));
		await expect(
			GitProviderService.listRepos(github, undecryptable()),
		).rejects.toThrow("Couldn't decrypt the stored access token.");
		expect(calls).toHaveLength(0);
	});
});

describe("listBranches", () => {
	test("reads arrays and Bitbucket's paged values from each provider's own path", async () => {
		const calls = stubFetch((url) =>
			url.includes("bitbucket")
				? Response.json({ values: [{ name: "main" }, { name: "dev" }] })
				: Response.json([{ name: "main" }]),
		);
		expect(
			await GitProviderService.listBranches(github, validConnection(), "a/b"),
		).toEqual(["main"]);
		expect(
			await GitProviderService.listBranches(
				bitbucket,
				validConnection(),
				"a/b",
			),
		).toEqual(["main", "dev"]);
		await GitProviderService.listBranches(gitlab, validConnection(), "g/p");
		await GitProviderService.listBranches(gitea, validConnection(), "a/b");
		expect(calls.map((c) => c.url)).toEqual([
			"https://api.github.com/repos/a/b/branches?per_page=100",
			"https://api.bitbucket.org/2.0/repositories/a/b/refs/branches?pagelen=100",
			"https://gitlab.com/api/v4/projects/g%2Fp/repository/branches?per_page=100",
			"https://gitea.example.com/api/v1/repos/a/b/branches?limit=50",
		]);
		expect(headersOf(calls[0]).Accept).toBe("application/json");
		expect(calls[0].init.method).toBe("GET");
	});

	test("a refusal becomes a GitProviderRefusedError, anything else a plain error", async () => {
		stubFetch(() => new Response("{}", { status: 401 }));
		const refused = await GitProviderService.listBranches(
			github,
			validConnection(),
			"a/b",
		).catch((err: unknown) => err);
		expect(refused).toBeInstanceOf(GitProviderRefusedError);
		expect(
			(refused as InstanceType<typeof GitProviderRefusedError>).status,
		).toBe(401);

		stubFetch(() => new Response("x".repeat(400), { status: 500 }));
		const failed = (await GitProviderService.listBranches(
			github,
			validConnection(),
			"a/b",
		).catch((err: unknown) => err)) as Error;
		expect(failed).not.toBeInstanceOf(GitProviderRefusedError);
		expect(failed.message).toBe(`github answered 500: ${"x".repeat(300)}`);
	});

	test("an undecryptable access token is reported before any request", async () => {
		const calls = stubFetch(() => Response.json([]));
		await expect(
			GitProviderService.listBranches(github, undecryptable(), "a/b"),
		).rejects.toThrow("Couldn't decrypt the stored access token.");
		expect(calls).toHaveLength(0);
	});
});

describe("webhooks", () => {
	const hook = {
		pullRequests: true,
		repo: "a/b",
		secret: "s3cret",
		url: "https://homerun.example.com/api/v1/webhooks/git",
	};

	test("creating a webhook sends a JSON body and returns the provider's id", async () => {
		const calls = stubFetch(() => Response.json({ id: 42 }));
		expect(
			await GitProviderService.createPushWebhook(
				github,
				validConnection(),
				hook,
			),
		).toBe("42");
		expect(calls[0].init.method).toBe("POST");
		expect(headersOf(calls[0])["Content-Type"]).toBe("application/json");
		expect(JSON.parse(String(calls[0].init.body))).toBeObject();
	});

	test("Bitbucket's hook id is its uuid", async () => {
		stubFetch(() => Response.json({ uuid: "{abc}" }));
		expect(
			await GitProviderService.createPushWebhook(
				bitbucket,
				validConnection(),
				hook,
			),
		).toBe("{abc}");
	});

	test("a created hook with no id is an error", async () => {
		stubFetch(() => Response.json({}));
		await expect(
			GitProviderService.createPushWebhook(gitea, validConnection(), hook),
		).rejects.toThrow("Gitea didn't return an id for the webhook.");
	});

	test("deleting a hook that's already gone counts as deleted", async () => {
		const calls = stubFetch(() => new Response("", { status: 404 }));
		await GitProviderService.deletePushWebhook(
			github,
			validConnection(),
			"a/b",
			"42",
		);
		expect(calls[0].init.method).toBe("DELETE");
		expect(calls[0].url).toContain("/repos/a/b/hooks/42");
	});

	test("any other delete failure propagates", async () => {
		stubFetch(() => new Response("{}", { status: 403 }));
		await expect(
			GitProviderService.deletePushWebhook(
				github,
				validConnection(),
				"a/b",
				"1",
			),
		).rejects.toBeInstanceOf(GitProviderRefusedError);
		stubFetch(() => new Response("boom", { status: 500 }));
		await expect(
			GitProviderService.deletePushWebhook(
				github,
				validConnection(),
				"a/b",
				"1",
			),
		).rejects.toThrow("github answered 500: boom");
	});
});

describe("hasDockerfile", () => {
	test("asks each provider for the file at the given ref", async () => {
		const calls = stubFetch(() => new Response("", { status: 200 }));
		for (const provider of [github, gitea, gitlab, bitbucket]) {
			expect(
				await GitProviderService.hasDockerfile(
					provider,
					validConnection(),
					"a/b",
					"feat/x",
				),
			).toBe(true);
		}
		expect(calls.map((c) => c.url)).toEqual([
			"https://api.github.com/repos/a/b/contents/Dockerfile?ref=feat%2Fx",
			"https://gitea.example.com/api/v1/repos/a/b/contents/Dockerfile?ref=feat%2Fx",
			"https://gitlab.com/api/v4/projects/a%2Fb/repository/files/Dockerfile?ref=feat%2Fx",
			"https://api.bitbucket.org/2.0/repositories/a/b/src/feat%2Fx/Dockerfile",
		]);
	});

	test("a missing file, a network failure or an unusable token all answer false", async () => {
		stubFetch(() => new Response("", { status: 404 }));
		expect(
			await GitProviderService.hasDockerfile(
				github,
				validConnection(),
				"a/b",
				"main",
			),
		).toBe(false);
		stubFetch(() => {
			throw new Error("offline");
		});
		expect(
			await GitProviderService.hasDockerfile(
				github,
				validConnection(),
				"a/b",
				"main",
			),
		).toBe(false);
		const calls = stubFetch(() => new Response(""));
		expect(
			await GitProviderService.hasDockerfile(
				github,
				undecryptable(),
				"a/b",
				"main",
			),
		).toBe(false);
		expect(calls).toHaveLength(0);
	});
});

describe("authorizeUrl", () => {
	test("an unknown kind throws", () => {
		const bogus = "svn" as GitProviderConfig["kind"];
		expect(() =>
			GitProviderService.authorizeUrl(providerOf(bogus), "s", "cb"),
		).toThrow("Unknown git provider kind: svn");
	});
});
