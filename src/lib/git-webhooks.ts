import { createHmac, timingSafeEqual } from "node:crypto";
import type { GitProviderKind } from "$lib/server/db/schema";

export const GIT_WEBHOOK_PATH = "/api/v1/webhooks/git";

export interface PushedBranch {
	branch: string;
	commit: string | null;
}

export interface WebhookRequest {
	body: Record<string, unknown>;
	method: "POST";
	path: string;
}

/** The URL a provider delivers `serviceId`'s push events to. */
export function gitWebhookUrl(origin: string, serviceId: string): string {
	return `${origin.replace(/\/+$/, "")}${GIT_WEBHOOK_PATH}/${serviceId}`;
}

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

function hmacHex(secret: string, body: string): string {
	return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Whether a delivery really comes from the webhook Homerun registered with
 * `secret`. GitHub, Gitea and Bitbucket sign the raw body with HMAC-SHA256
 * (`X-Hub-Signature-256` / `X-Gitea-Signature` / `X-Hub-Signature`); GitLab
 * echoes the secret back in `X-Gitlab-Token`. `kind` null (a repo that isn't
 * on a configured provider) accepts any of those schemes.
 */
export function verifyGitWebhook(
	kind: GitProviderKind | null,
	headers: Headers,
	rawBody: string,
	secret: string,
): boolean {
	const expected = hmacHex(secret, rawBody);
	const hubSignature = (name: string) => {
		const value = headers.get(name);
		return value?.startsWith("sha256=")
			? safeEqual(value.slice(7), expected)
			: false;
	};
	const checks: Record<GitProviderKind, () => boolean> = {
		bitbucket: () => hubSignature("x-hub-signature"),
		gitea: () => {
			const value = headers.get("x-gitea-signature");
			return value
				? safeEqual(value, expected)
				: hubSignature("x-hub-signature-256");
		},
		github: () => hubSignature("x-hub-signature-256"),
		gitlab: () => {
			const token = headers.get("x-gitlab-token");
			return token ? safeEqual(token, secret) : false;
		},
	};
	if (kind) {
		return checks[kind]();
	}
	return Object.values(checks).some((check) => check());
}

function branchFromRef(ref: unknown): string | null {
	return typeof ref === "string" && ref.startsWith("refs/heads/")
		? ref.slice("refs/heads/".length)
		: null;
}

const ZERO_SHA = /^0+$/;

/**
 * The branches a push delivery updated, with the commit each now points at.
 * Empty for anything that isn't a branch push: a ping, a tag, a deleted
 * branch, another event type.
 */
export function parsePushEvent(
	headers: Headers,
	payload: unknown,
): PushedBranch[] {
	const body = (payload ?? {}) as Record<string, unknown>;

	if (headers.get("x-event-key") === "repo:push") {
		const changes =
			((body.push as Record<string, unknown> | undefined)?.changes as
				| Array<Record<string, unknown>>
				| undefined) ?? [];
		return changes.flatMap((change) => {
			const next = change.new as Record<string, unknown> | null | undefined;
			if (next?.type !== "branch" || typeof next.name !== "string") {
				return [];
			}
			const target = next.target as Record<string, unknown> | undefined;
			return [
				{
					branch: next.name,
					commit: typeof target?.hash === "string" ? target.hash : null,
				},
			];
		});
	}

	const event =
		headers.get("x-github-event") ??
		headers.get("x-gitea-event") ??
		headers.get("x-gitlab-event");
	if (!(event === "push" || event === "Push Hook")) {
		return [];
	}
	const branch = branchFromRef(body.ref);
	const after = typeof body.after === "string" ? body.after : null;
	if (!branch || body.deleted === true || (after && ZERO_SHA.test(after))) {
		return [];
	}
	const commit =
		typeof body.checkout_sha === "string" ? body.checkout_sha : after;
	return [{ branch, commit }];
}

/** The API call that registers a push webhook for `repo` on a provider of `kind`, relative to its API base. */
export function createWebhookRequest(
	kind: GitProviderKind,
	repo: string,
	url: string,
	secret: string,
): WebhookRequest {
	switch (kind) {
		case "github":
			return {
				body: {
					active: true,
					config: { content_type: "json", insecure_ssl: "0", secret, url },
					events: ["push"],
					name: "web",
				},
				method: "POST",
				path: `/repos/${repo}/hooks`,
			};
		case "gitea":
			return {
				body: {
					active: true,
					config: { content_type: "json", secret, url },
					events: ["push"],
					type: "gitea",
				},
				method: "POST",
				path: `/repos/${repo}/hooks`,
			};
		case "gitlab":
			return {
				body: {
					enable_ssl_verification: true,
					push_events: true,
					token: secret,
					url,
				},
				method: "POST",
				path: `/projects/${encodeURIComponent(repo)}/hooks`,
			};
		case "bitbucket":
			return {
				body: {
					active: true,
					description: "Homerun push-to-deploy",
					events: ["repo:push"],
					secret,
					url,
				},
				method: "POST",
				path: `/repositories/${repo}/hooks`,
			};
		default: {
			const exhaustive: never = kind;
			throw new Error(`Unknown git provider kind: ${exhaustive}`);
		}
	}
}

/** The API path that deletes webhook `hookId` from `repo`, relative to the provider's API base. */
export function deleteWebhookPath(
	kind: GitProviderKind,
	repo: string,
	hookId: string,
): string {
	if (kind === "gitlab") {
		return `/projects/${encodeURIComponent(repo)}/hooks/${hookId}`;
	}
	if (kind === "bitbucket") {
		return `/repositories/${repo}/hooks/${encodeURIComponent(hookId)}`;
	}
	return `/repos/${repo}/hooks/${hookId}`;
}

/** The id a provider's create-webhook response gives the new hook. */
export function webhookIdFrom(
	kind: GitProviderKind,
	response: Record<string, unknown>,
): string | null {
	const id = kind === "bitbucket" ? response.uuid : response.id;
	return typeof id === "string" || typeof id === "number" ? String(id) : null;
}
