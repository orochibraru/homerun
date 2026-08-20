import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "$lib/config";
import type { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { Logger } from "$lib/logger";
import type { GitProviderConfig, GitProviderKind } from "$lib/server/db/schema";
import { decryptSecret } from "./secrets.ts";

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

const logger = new Logger("GitProvider");

export interface GitRepo {
	cloneUrl: string;
	defaultBranch: string;
	fullName: string;
	private: boolean;
}

export interface ExchangedToken {
	accessToken: string;
	expiresAt: Date | null;
	providerUsername: string;
	refreshToken: string | null;
}

interface ProviderEndpoints {
	api: string;
	authorize: string;
	scope: string;
	token: string;
}

/**
 * OAuth App client for git-hosting providers (GitHub/GitLab/Gitea/
 * Bitbucket) : lets a user connect their own account (see the Git
 * Providers page for the instance-wide OAuth App config each of these
 * needs registered on the provider's own site first) so the Source tab can
 * browse their repos and check for a Dockerfile instead of pasting a raw
 * (possibly token-embedded) URL. One standard OAuth2 authorization-code
 * flow per provider, differing mainly in endpoint URLs/request shapes :
 * see `endpoints()` below for exactly what differs.
 *
 * Not live-tested against a real registered OAuth App on each provider
 * (that requires the admin to actually register one on GitHub/GitLab/
 * Gitea/Bitbucket's own site first, with a real callback URL : nothing
 * this session could do on its own, unlike everything else built this
 * session). Built carefully from each provider's own standard, well-
 * documented OAuth2 + REST API shapes; verify the first real connect end
 * to end once an OAuth App is registered.
 */
function endpoints(provider: GitProviderConfig): ProviderEndpoints {
	const base = provider.baseUrl?.replace(/\/+$/, "") || null;
	switch (provider.kind) {
		case "github":
			return {
				api: "https://api.github.com",
				authorize: "https://github.com/login/oauth/authorize",
				scope: "repo read:user",
				token: "https://github.com/login/oauth/access_token",
			};
		case "gitlab": {
			const b = base ?? "https://gitlab.com";
			return {
				api: `${b}/api/v4`,
				authorize: `${b}/oauth/authorize`,
				scope: "read_api read_user",
				token: `${b}/oauth/token`,
			};
		}
		case "gitea": {
			// Self-hosted only : there's no public gitea.com instance to
			// default to, unlike the other three.
			if (!base) {
				throw new Error("Gitea providers require a base URL.");
			}
			return {
				api: `${base}/api/v1`,
				authorize: `${base}/login/oauth/authorize`,
				scope: "read:repository read:user",
				token: `${base}/login/oauth/access_token`,
			};
		}
		case "bitbucket":
			return {
				api: "https://api.bitbucket.org/2.0",
				authorize: "https://bitbucket.org/site/oauth2/authorize",
				scope: "repository account",
				token: "https://bitbucket.org/site/oauth2/access_token",
			};
		default: {
			const exhaustive: never = provider.kind;
			throw new Error(`Unknown git provider kind: ${exhaustive}`);
		}
	}
}

function authHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

export class GitProviderService {
	/**
	 * Signed, stateless CSRF state param for the OAuth redirect round-trip :
	 * no server-side storage/cleanup needed (unlike a DB-backed state
	 * table), verified purely from the value itself plus config.auth.secret.
	 */
	static createState(providerId: string, userId: string): string {
		const nonce = randomBytes(8).toString("hex");
		const payload = `${providerId}:${userId}:${nonce}:${Date.now()}`;
		const sig = createHmac("sha256", config.auth.secret)
			.update(payload)
			.digest("hex");
		return Buffer.from(`${payload}:${sig}`).toString("base64url");
	}

	static verifyState(
		state: string,
		providerId: string,
		userId: string,
	): boolean {
		try {
			const decoded = Buffer.from(state, "base64url").toString("utf8");
			const parts = decoded.split(":");
			const sig = parts.pop();
			const [pid, uid, , tsStr] = parts;
			if (!sig || pid !== providerId || uid !== userId) {
				return false;
			}
			const payload = parts.join(":");
			const expected = createHmac("sha256", config.auth.secret)
				.update(payload)
				.digest("hex");
			const sigBuf = Buffer.from(sig, "hex");
			const expectedBuf = Buffer.from(expected, "hex");
			if (
				sigBuf.length !== expectedBuf.length ||
				!timingSafeEqual(sigBuf, expectedBuf)
			) {
				return false;
			}
			const ts = Number(tsStr);
			return !!ts && Date.now() - ts <= STATE_MAX_AGE_MS;
		} catch {
			return false;
		}
	}

	/** URL to send the browser to, kicking off the provider's own consent screen. */
	static authorizeUrl(
		provider: GitProviderConfig,
		state: string,
		redirectUri: string,
	): string {
		const { authorize, scope } = endpoints(provider);
		const url = new URL(authorize);
		url.searchParams.set("client_id", provider.clientId);
		url.searchParams.set("redirect_uri", redirectUri);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("scope", scope);
		url.searchParams.set("state", state);
		return url.toString();
	}

	/** Exchanges the callback's `code` for an access (+ refresh) token, then fetches the connected account's own username. */
	static async exchangeCode(
		provider: GitProviderConfig,
		code: string,
		redirectUri: string,
	): Promise<ExchangedToken> {
		const { token: tokenUrl } = endpoints(provider);
		const clientSecret = decryptSecret(provider.clientSecretEnc) ?? "";

		let accessToken: string;
		let refreshToken: string | null = null;
		let expiresIn: number | null = null;

		if (provider.kind === "bitbucket") {
			// Bitbucket authenticates the token request itself via HTTP Basic
			// (client_id:client_secret), not as body params like the others.
			const res = await fetch(tokenUrl, {
				body: new URLSearchParams({ code, grant_type: "authorization_code" }),
				headers: {
					Authorization: `Basic ${Buffer.from(`${provider.clientId}:${clientSecret}`).toString("base64")}`,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				method: "POST",
			});
			if (!res.ok) {
				throw new Error(
					`Token exchange failed: ${res.status} ${await res.text()}`,
				);
			}
			const body = (await res.json()) as {
				access_token: string;
				expires_in?: number;
				refresh_token?: string;
			};
			accessToken = body.access_token;
			refreshToken = body.refresh_token ?? null;
			expiresIn = body.expires_in ?? null;
		} else {
			const res = await fetch(tokenUrl, {
				body: new URLSearchParams({
					client_id: provider.clientId,
					client_secret: clientSecret,
					code,
					grant_type: "authorization_code",
					redirect_uri: redirectUri,
				}),
				headers: {
					Accept: "application/json",
					"Content-Type": "application/x-www-form-urlencoded",
				},
				method: "POST",
			});
			if (!res.ok) {
				throw new Error(
					`Token exchange failed: ${res.status} ${await res.text()}`,
				);
			}
			const body = (await res.json()) as {
				access_token?: string;
				error?: string;
				error_description?: string;
				expires_in?: number;
				refresh_token?: string;
			};
			if (!body.access_token) {
				throw new Error(
					`Token exchange failed: ${body.error ?? "no access_token"} ${body.error_description ?? ""}`,
				);
			}
			accessToken = body.access_token;
			refreshToken = body.refresh_token ?? null;
			expiresIn = body.expires_in ?? null;
		}

		const providerUsername = await GitProviderService.fetchUsername(
			provider,
			accessToken,
		);

		return {
			accessToken,
			expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
			providerUsername,
			refreshToken,
		};
	}

	private static async fetchUsername(
		provider: GitProviderConfig,
		accessToken: string,
	): Promise<string> {
		const { api } = endpoints(provider);
		const res = await fetch(`${api}/user`, {
			headers: authHeader(accessToken),
		});
		if (!res.ok) {
			throw new Error(`Couldn't fetch account info: ${res.status}`);
		}
		const body = (await res.json()) as {
			login?: string;
			username?: string;
		};
		return body.login ?? body.username ?? "unknown";
	}

	/** Lists repos the connected account is a member of, normalized across providers. */
	static async listRepos(
		provider: GitProviderConfig,
		connection: GitConnectionDTO,
	): Promise<GitRepo[]> {
		const { api } = endpoints(provider);
		const accessToken = decryptSecret(connection.accessTokenEnc);
		if (!accessToken) {
			throw new Error("Couldn't decrypt the stored access token.");
		}
		const headers = authHeader(accessToken);

		switch (provider.kind) {
			case "github": {
				const res = await fetch(`${api}/user/repos?per_page=100&sort=updated`, {
					headers,
				});
				if (!res.ok) {
					throw new Error(`Couldn't list repos: ${res.status}`);
				}
				const body = (await res.json()) as Array<{
					clone_url: string;
					default_branch: string;
					full_name: string;
					private: boolean;
				}>;
				return body.map((r) => ({
					cloneUrl: r.clone_url,
					defaultBranch: r.default_branch,
					fullName: r.full_name,
					private: r.private,
				}));
			}
			case "gitlab": {
				const res = await fetch(
					`${api}/projects?membership=true&per_page=100`,
					{ headers },
				);
				if (!res.ok) {
					throw new Error(`Couldn't list repos: ${res.status}`);
				}
				const body = (await res.json()) as Array<{
					default_branch: string;
					http_url_to_repo: string;
					path_with_namespace: string;
					visibility: string;
				}>;
				return body.map((r) => ({
					cloneUrl: r.http_url_to_repo,
					defaultBranch: r.default_branch,
					fullName: r.path_with_namespace,
					private: r.visibility !== "public",
				}));
			}
			case "gitea": {
				const res = await fetch(`${api}/user/repos?limit=50`, { headers });
				if (!res.ok) {
					throw new Error(`Couldn't list repos: ${res.status}`);
				}
				const body = (await res.json()) as Array<{
					clone_url: string;
					default_branch: string;
					full_name: string;
					private: boolean;
				}>;
				return body.map((r) => ({
					cloneUrl: r.clone_url,
					defaultBranch: r.default_branch,
					fullName: r.full_name,
					private: r.private,
				}));
			}
			case "bitbucket": {
				const res = await fetch(`${api}/repositories?role=member&pagelen=100`, {
					headers,
				});
				if (!res.ok) {
					throw new Error(`Couldn't list repos: ${res.status}`);
				}
				const body = (await res.json()) as {
					values: Array<{
						full_name: string;
						is_private: boolean;
						links: { clone: Array<{ href: string; name: string }> };
						mainbranch?: { name: string };
					}>;
				};
				return body.values.map((r) => ({
					cloneUrl:
						r.links.clone.find((c) => c.name === "https")?.href ??
						r.links.clone[0]?.href ??
						"",
					defaultBranch: r.mainbranch?.name ?? "main",
					fullName: r.full_name,
					private: r.is_private,
				}));
			}
			default: {
				const exhaustive: never = provider.kind;
				throw new Error(`Unknown git provider kind: ${exhaustive}`);
			}
		}
	}

	/** Whether `repoFullName` has a Dockerfile at its root, on the given ref. */
	static async hasDockerfile(
		provider: GitProviderConfig,
		connection: GitConnectionDTO,
		repoFullName: string,
		ref: string,
	): Promise<boolean> {
		const { api } = endpoints(provider);
		const accessToken = decryptSecret(connection.accessTokenEnc);
		if (!accessToken) {
			return false;
		}
		const headers = authHeader(accessToken);

		try {
			let url: string;
			switch (provider.kind) {
				case "github":
				case "gitea":
					url = `${api}/repos/${repoFullName}/contents/Dockerfile?ref=${encodeURIComponent(ref)}`;
					break;
				case "gitlab":
					url = `${api}/projects/${encodeURIComponent(repoFullName)}/repository/files/Dockerfile?ref=${encodeURIComponent(ref)}`;
					break;
				case "bitbucket":
					url = `${api}/repositories/${repoFullName}/src/${encodeURIComponent(ref)}/Dockerfile`;
					break;
				default: {
					const exhaustive: never = provider.kind;
					throw new Error(`Unknown git provider kind: ${exhaustive}`);
				}
			}
			const res = await fetch(url, { headers, method: "GET" });
			return res.ok;
		} catch (err) {
			logger.warn(`Dockerfile check failed: ${repoFullName}@${ref}`, err);
			return false;
		}
	}

	static defaultsFor(kind: GitProviderKind): {
		name: string;
		requiresBaseUrl: boolean;
	} {
		switch (kind) {
			case "github":
				return { name: "GitHub", requiresBaseUrl: false };
			case "gitlab":
				return { name: "GitLab", requiresBaseUrl: false };
			case "gitea":
				return { name: "Gitea", requiresBaseUrl: true };
			case "bitbucket":
				return { name: "Bitbucket", requiresBaseUrl: false };
			default: {
				const exhaustive: never = kind;
				throw new Error(`Unknown git provider kind: ${exhaustive}`);
			}
		}
	}
}
