import { afterEach, describe, expect, mock, test } from "bun:test";
import type { GitConnectionDTO } from "../../../src/lib/dto/git-connection-dto";
import type { GitProviderConfig } from "../../../src/lib/server/db/schema";
import {
	decryptSecret,
	encryptSecret,
} from "../../../src/lib/services/secrets";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { GitProviderService, refusalFrom } = await import(
	"../../../src/lib/services/git-provider.service"
);

const gitea: GitProviderConfig = {
	baseUrl: "https://gitea.example.com",
	clientId: "client",
	clientSecretEnc: encryptSecret("shh"),
	enabled: true,
	id: "gitea-1",
	kind: "gitea",
	name: "Gitea",
};

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

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("GitProviderService.accessToken", () => {
	test("returns the stored token untouched while it's still valid", async () => {
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return new Response("{}");
		}) as unknown as typeof fetch;

		const token = await GitProviderService.accessToken(
			gitea,
			connection({
				accessTokenEnc: encryptSecret("fresh"),
				expiresAt: new Date(Date.now() + 30 * 60 * 1000),
				id: "c1",
				refreshTokenEnc: encryptSecret("refresh"),
			}),
		);

		expect(token).toBe("fresh");
		expect(called).toBe(false);
	});

	test("refreshes an expired token and persists the rotated pair", async () => {
		const bodies: string[] = [];
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			bodies.push(String(init.body));
			return Response.json({
				access_token: "new-access",
				expires_in: 3600,
				refresh_token: "new-refresh",
			});
		}) as unknown as typeof fetch;

		const row: FakeRow = {
			accessTokenEnc: encryptSecret("stale"),
			expiresAt: new Date(Date.now() - 1000),
			id: "c2",
			refreshTokenEnc: encryptSecret("old-refresh"),
		};
		const conn = connection(row);

		const [a, b] = await Promise.all([
			GitProviderService.accessToken(gitea, conn),
			GitProviderService.accessToken(gitea, conn),
		]);

		expect(a).toBe("new-access");
		expect(b).toBe("new-access");
		expect(bodies).toHaveLength(1);
		const sent = new URLSearchParams(bodies[0]);
		expect(sent.get("grant_type")).toBe("refresh_token");
		expect(sent.get("refresh_token")).toBe("old-refresh");
		expect(sent.get("client_id")).toBe("client");
		expect(decryptSecret(row.accessTokenEnc)).toBe("new-access");
		expect(decryptSecret(row.refreshTokenEnc ?? "")).toBe("new-refresh");
		expect(row.expiresAt?.getTime()).toBeGreaterThan(Date.now());
	});

	test("falls back to the stale token when the provider rejects the refresh", async () => {
		globalThis.fetch = (async () =>
			new Response("invalid_grant", {
				status: 400,
			})) as unknown as typeof fetch;

		const token = await GitProviderService.accessToken(
			gitea,
			connection({
				accessTokenEnc: encryptSecret("stale"),
				expiresAt: new Date(Date.now() - 1000),
				id: "c3",
				refreshTokenEnc: encryptSecret("revoked"),
			}),
		);

		expect(token).toBe("stale");
	});
});

describe("refusalFrom", () => {
	test("tells Gitea's stale-grant scope mismatch to revoke before reconnecting", () => {
		const refusal = refusalFrom(
			"Ombrage git",
			403,
			JSON.stringify({
				message:
					"token does not have at least one of required scope(s), required=[write:repository], token scope=read:repository,read:user",
			}),
		);
		expect(refusal.reconnectHelps).toBe(true);
		expect(refusal.message).toContain("revoke Homerun");
		expect(refusal.message).toContain("Authorized OAuth2 Applications");
	});

	test("a missing scope keeps the provider's reason and suggests reconnecting", () => {
		const refusal = refusalFrom(
			"Gitea",
			403,
			JSON.stringify({
				message:
					"token does not have at least one of required scope(s), required=[write:repository]",
			}),
		);
		expect(refusal.reconnectHelps).toBe(true);
		expect(refusal.message).toContain("required=[write:repository]");
		expect(refusal.message).toContain("Reconnect it");
	});

	test("missing repository rights say reconnecting won't help", () => {
		const refusal = refusalFrom(
			"Gitea",
			403,
			JSON.stringify({
				message:
					"user should be an owner or a collaborator with admin write of a repository",
			}),
		);
		expect(refusal.reconnectHelps).toBe(false);
		expect(refusal.message).toContain("admin write of a repository");
		expect(refusal.message).toContain("Reconnecting won't change this");
	});

	test("a 401 or an empty body always suggests reconnecting", () => {
		expect(refusalFrom("GitHub", 401, "{}").reconnectHelps).toBe(true);
		expect(refusalFrom("GitHub", 403, "").reconnectHelps).toBe(true);
	});

	test("reads GitLab and Bitbucket error shapes", () => {
		expect(
			refusalFrom(
				"GitLab",
				403,
				JSON.stringify({ error: "insufficient_scope" }),
			).message,
		).toContain("insufficient_scope");
		expect(
			refusalFrom(
				"Bitbucket",
				403,
				JSON.stringify({ error: { message: "Access denied" } }),
			).message,
		).toContain("Access denied");
	});
});
