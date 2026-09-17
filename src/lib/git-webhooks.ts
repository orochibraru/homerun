import { createHmac, timingSafeEqual } from "node:crypto";
import type { GitProviderKind } from "$lib/server/db/schema";

export const GIT_WEBHOOK_PATH = "/api/v1/webhooks/git";

export const GIT_CONNECT_RETURN_COOKIE = "homerun_git_connect_return";

export interface PushedBranch {
	branch: string;
	commit: string | null;
}

export type PullRequestAction = "open" | "update" | "close";

export interface PullRequestEvent {
	action: PullRequestAction;
	branch: string | null;
	commit: string | null;
	fromFork: boolean;
	number: number;
	title: string;
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

const BITBUCKET_PULL_REQUEST_EVENTS = [
	"pullrequest:created",
	"pullrequest:updated",
	"pullrequest:fulfilled",
	"pullrequest:rejected",
];

/**
 * The API call that registers a webhook for `repo` on a provider of `kind`,
 * relative to its API base: push events always, pull request events too when
 * `hook.pullRequests` is set.
 */
export function createWebhookRequest(
	kind: GitProviderKind,
	repo: string,
	hook: { pullRequests?: boolean; secret: string; url: string },
): WebhookRequest {
	const { pullRequests = false, secret, url } = hook;
	const events = pullRequests ? ["push", "pull_request"] : ["push"];
	switch (kind) {
		case "github":
			return {
				body: {
					active: true,
					config: { content_type: "json", insecure_ssl: "0", secret, url },
					events,
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
					events,
					type: "gitea",
				},
				method: "POST",
				path: `/repos/${repo}/hooks`,
			};
		case "gitlab":
			return {
				body: {
					enable_ssl_verification: true,
					merge_requests_events: pullRequests,
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
					events: [
						"repo:push",
						...(pullRequests ? BITBUCKET_PULL_REQUEST_EVENTS : []),
					],
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

const GITHUB_PULL_REQUEST_ACTIONS: Record<string, PullRequestAction> = {
	closed: "close",
	opened: "open",
	reopened: "open",
	synchronize: "update",
	synchronized: "update",
};

const GITLAB_MERGE_REQUEST_ACTIONS: Record<string, PullRequestAction> = {
	close: "close",
	merge: "close",
	open: "open",
	reopen: "open",
	update: "update",
};

const BITBUCKET_PULL_REQUEST_ACTIONS: Record<string, PullRequestAction> = {
	"pullrequest:created": "open",
	"pullrequest:fulfilled": "close",
	"pullrequest:rejected": "close",
	"pullrequest:updated": "update",
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
	return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Whether a pull request's head and base repo identifiers are both known and equal: anything missing counts as a fork. */
function sameRepo(head: unknown, base: unknown): boolean {
	const known = (value: unknown) =>
		(typeof value === "string" && value.length > 0) ||
		(typeof value === "number" && Number.isFinite(value));
	return known(head) && known(base) && String(head) === String(base);
}

function pullRequestEvent(
	action: PullRequestAction | undefined,
	fields: {
		branch: unknown;
		commit: unknown;
		headRepo: unknown;
		baseRepo: unknown;
		number: unknown;
		title: unknown;
	},
): PullRequestEvent | null {
	const number = Number(fields.number);
	if (!(action && Number.isInteger(number) && number > 0)) {
		return null;
	}
	return {
		action,
		branch: stringOrNull(fields.branch),
		commit: stringOrNull(fields.commit),
		fromFork: !sameRepo(fields.headRepo, fields.baseRepo),
		number,
		title: stringOrNull(fields.title) ?? `#${number}`,
	};
}

/**
 * The pull request a delivery opened, updated or closed, with the head
 * branch and commit a preview builds. Null for anything else: a push, a
 * label change, a review. GitHub and Gitea share one payload shape, GitLab
 * sends a "Merge Request Hook" and Bitbucket a `pullrequest:*` event key.
 * Bitbucket only sends an abbreviated commit hash, which can't be fetched, so
 * its previews build the branch. `fromFork` is true unless the head repo is
 * positively the base repo, so a payload missing either counts as a fork.
 */
export function parsePullRequestEvent(
	headers: Headers,
	payload: unknown,
): PullRequestEvent | null {
	const body = record(payload);
	const eventKey = headers.get("x-event-key");
	if (eventKey?.startsWith("pullrequest:")) {
		const pullRequest = record(body.pullrequest);
		const source = record(pullRequest.source);
		return pullRequestEvent(BITBUCKET_PULL_REQUEST_ACTIONS[eventKey], {
			branch: record(source.branch).name,
			commit: null,
			headRepo: record(source.repository).full_name,
			baseRepo: record(record(pullRequest.destination).repository).full_name,
			number: pullRequest.id,
			title: pullRequest.title,
		});
	}
	if (headers.get("x-gitlab-event") === "Merge Request Hook") {
		const attributes = record(body.object_attributes);
		return pullRequestEvent(
			GITLAB_MERGE_REQUEST_ACTIONS[String(attributes.action)],
			{
				branch: attributes.source_branch,
				commit: record(attributes.last_commit).id,
				headRepo: attributes.source_project_id,
				baseRepo: attributes.target_project_id,
				number: attributes.iid,
				title: attributes.title,
			},
		);
	}
	const event = headers.get("x-github-event") ?? headers.get("x-gitea-event");
	if (event !== "pull_request") {
		return null;
	}
	const pullRequest = record(body.pull_request);
	const head = record(pullRequest.head);
	return pullRequestEvent(GITHUB_PULL_REQUEST_ACTIONS[String(body.action)], {
		branch: head.ref,
		commit: head.sha,
		headRepo: record(head.repo).full_name,
		baseRepo: record(record(pullRequest.base).repo).full_name,
		number: body.number ?? pullRequest.number,
		title: pullRequest.title,
	});
}

/**
 * The slug of pull request `number`'s preview of a service: `<slug>-pr-<n>`,
 * with the parent slug cut short so the whole thing stays a valid 63
 * character DNS label.
 */
export function previewSlug(parentSlug: string, number: number): string {
	const suffix = `-pr-${number}`;
	return `${parentSlug.slice(0, 63 - suffix.length).replace(/-+$/, "")}${suffix}`;
}
