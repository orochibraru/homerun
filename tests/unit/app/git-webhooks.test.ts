import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
	createWebhookRequest,
	deleteWebhookPath,
	gitWebhookUrl,
	parsePullRequestEvent,
	parsePushEvent,
	parseTagPushEvent,
	previewSlug,
	verifyGitWebhook,
	webhookIdFrom,
} from "../../../src/lib/git-webhooks";

const secret = "s3cret";
const body = JSON.stringify({ ref: "refs/heads/main" });
const signature = createHmac("sha256", secret).update(body).digest("hex");

describe("verifyGitWebhook", () => {
	test("GitHub needs a matching X-Hub-Signature-256", () => {
		expect(
			verifyGitWebhook(
				"github",
				new Headers({ "x-hub-signature-256": `sha256=${signature}` }),
				body,
				secret,
			),
		).toBe(true);
		expect(
			verifyGitWebhook(
				"github",
				new Headers({ "x-hub-signature-256": `sha256=${"0".repeat(64)}` }),
				body,
				secret,
			),
		).toBe(false);
		expect(verifyGitWebhook("github", new Headers(), body, secret)).toBe(false);
	});

	test("Gitea accepts its own header or the GitHub-style one", () => {
		expect(
			verifyGitWebhook(
				"gitea",
				new Headers({ "x-gitea-signature": signature }),
				body,
				secret,
			),
		).toBe(true);
		expect(
			verifyGitWebhook(
				"gitea",
				new Headers({ "x-hub-signature-256": `sha256=${signature}` }),
				body,
				secret,
			),
		).toBe(true);
	});

	test("GitLab compares the echoed token, Bitbucket the HMAC", () => {
		expect(
			verifyGitWebhook(
				"gitlab",
				new Headers({ "x-gitlab-token": secret }),
				body,
				secret,
			),
		).toBe(true);
		expect(
			verifyGitWebhook(
				"gitlab",
				new Headers({ "x-gitlab-token": "wrong" }),
				body,
				secret,
			),
		).toBe(false);
		expect(
			verifyGitWebhook(
				"bitbucket",
				new Headers({ "x-hub-signature": `sha256=${signature}` }),
				body,
				secret,
			),
		).toBe(true);
	});

	test("an unknown provider accepts any valid scheme but not a bad one", () => {
		expect(
			verifyGitWebhook(
				null,
				new Headers({ "x-gitlab-token": secret }),
				body,
				secret,
			),
		).toBe(true);
		expect(
			verifyGitWebhook(
				null,
				new Headers({ "x-hub-signature-256": "sha256=nope" }),
				body,
				secret,
			),
		).toBe(false);
	});
});

describe("parsePushEvent", () => {
	test("GitHub and Gitea branch pushes", () => {
		expect(
			parsePushEvent(new Headers({ "x-github-event": "push" }), {
				after: "abc123",
				ref: "refs/heads/main",
			}),
		).toEqual([{ branch: "main", commit: "abc123" }]);
		expect(
			parsePushEvent(new Headers({ "x-gitea-event": "push" }), {
				after: "def456",
				ref: "refs/heads/feature/x",
			}),
		).toEqual([{ branch: "feature/x", commit: "def456" }]);
	});

	test("GitLab prefers checkout_sha", () => {
		expect(
			parsePushEvent(new Headers({ "x-gitlab-event": "Push Hook" }), {
				after: "aaa",
				checkout_sha: "bbb",
				ref: "refs/heads/main",
			}),
		).toEqual([{ branch: "main", commit: "bbb" }]);
	});

	test("Bitbucket lists every branch change", () => {
		expect(
			parsePushEvent(new Headers({ "x-event-key": "repo:push" }), {
				push: {
					changes: [
						{ new: { name: "main", target: { hash: "111" }, type: "branch" } },
						{ new: { name: "v1.0", target: { hash: "222" }, type: "tag" } },
						{ new: null },
					],
				},
			}),
		).toEqual([{ branch: "main", commit: "111" }]);
	});

	test("ignores pings, tags and deleted branches", () => {
		expect(
			parsePushEvent(new Headers({ "x-github-event": "ping" }), {}),
		).toEqual([]);
		expect(
			parsePushEvent(new Headers({ "x-github-event": "push" }), {
				after: "abc",
				ref: "refs/tags/v1",
			}),
		).toEqual([]);
		expect(
			parsePushEvent(new Headers({ "x-github-event": "push" }), {
				after: "0000000000000000000000000000000000000000",
				deleted: true,
				ref: "refs/heads/old",
			}),
		).toEqual([]);
	});
});

describe("webhook API shapes", () => {
	test("each provider's create request targets the repo's hooks", () => {
		const url = gitWebhookUrl("https://homerun.example.com/", "svc-1");
		expect(url).toBe("https://homerun.example.com/api/v1/webhooks/git/svc-1");
		expect(
			createWebhookRequest("github", "acme/api", { secret, url }).path,
		).toBe("/repos/acme/api/hooks");
		expect(
			createWebhookRequest("gitlab", "group/sub/api", { secret, url }).path,
		).toBe("/projects/group%2Fsub%2Fapi/hooks");
		expect(
			createWebhookRequest("bitbucket", "ws/api", { secret, url }).body.events,
		).toEqual(["repo:push"]);
		expect(deleteWebhookPath("gitea", "acme/api", "7")).toBe(
			"/repos/acme/api/hooks/7",
		);
	});

	test("pull request events are only subscribed when previews want them", () => {
		expect(
			createWebhookRequest("github", "acme/api", {
				pullRequests: true,
				secret,
				url: "https://h/x",
			}).body.events,
		).toEqual(["push", "pull_request"]);
		expect(
			createWebhookRequest("gitlab", "acme/api", {
				pullRequests: true,
				secret,
				url: "https://h/x",
			}).body.merge_requests_events,
		).toBe(true);
		expect(
			createWebhookRequest("bitbucket", "ws/api", {
				pullRequests: true,
				secret,
				url: "https://h/x",
			}).body.events,
		).toContain("pullrequest:fulfilled");
	});

	test("tag pushes are only subscribed on GitLab, the others send them as pushes", () => {
		const hook = { secret, tags: true, url: "https://h/x" };
		expect(
			createWebhookRequest("gitlab", "acme/api", hook).body.tag_push_events,
		).toBe(true);
		expect(
			createWebhookRequest("gitlab", "acme/api", { secret, url: "https://h/x" })
				.body.tag_push_events,
		).toBe(false);
		expect(
			createWebhookRequest("github", "acme/api", hook).body.events,
		).toEqual(["push"]);
		expect(
			createWebhookRequest("bitbucket", "ws/api", hook).body.events,
		).toEqual(["repo:push"]);
	});

	test("reads the new hook's id", () => {
		expect(webhookIdFrom("github", { id: 42 })).toBe("42");
		expect(webhookIdFrom("bitbucket", { uuid: "{abc}" })).toBe("{abc}");
		expect(webhookIdFrom("gitea", {})).toBeNull();
	});
});

describe("parseTagPushEvent", () => {
	const sha = "68c1b9e0f1a2b3c4d5e6f708192a3b4c5d6e7f80";
	const zero = "0000000000000000000000000000000000000000";

	test("GitHub and Gitea tag pushes", () => {
		for (const header of ["x-github-event", "x-gitea-event"]) {
			expect(
				parseTagPushEvent(new Headers({ [header]: "push" }), {
					after: sha,
					ref: "refs/tags/v1.2.0",
				}),
			).toEqual([{ commit: sha, tag: "v1.2.0" }]);
		}
	});

	test("GitHub's create event for a tag", () => {
		const headers = new Headers({ "x-github-event": "create" });
		expect(
			parseTagPushEvent(headers, { ref: "v2.0.0", ref_type: "tag" }),
		).toEqual([{ commit: null, tag: "v2.0.0" }]);
		expect(
			parseTagPushEvent(headers, { ref: "feature", ref_type: "branch" }),
		).toEqual([]);
	});

	test("GitLab Tag Push Hook, deletions ignored", () => {
		const headers = new Headers({ "x-gitlab-event": "Tag Push Hook" });
		expect(
			parseTagPushEvent(headers, {
				after: sha,
				checkout_sha: sha,
				object_kind: "tag_push",
				ref: "refs/tags/v3.1.0",
			}),
		).toEqual([{ commit: sha, tag: "v3.1.0" }]);
		expect(
			parseTagPushEvent(headers, {
				after: zero,
				checkout_sha: null,
				ref: "refs/tags/v3.1.0",
			}),
		).toEqual([]);
	});

	test("Bitbucket tag changes, branch changes skipped", () => {
		expect(
			parseTagPushEvent(new Headers({ "x-event-key": "repo:push" }), {
				push: {
					changes: [
						{ new: { name: "main", target: { hash: sha }, type: "branch" } },
						{ new: { name: "v4.0.0", target: { hash: sha }, type: "tag" } },
						{ new: null },
					],
				},
			}),
		).toEqual([{ commit: sha, tag: "v4.0.0" }]);
	});

	test("branch pushes, deleted tags and other events yield nothing", () => {
		const push = new Headers({ "x-github-event": "push" });
		expect(
			parseTagPushEvent(push, { after: sha, ref: "refs/heads/main" }),
		).toEqual([]);
		expect(
			parseTagPushEvent(push, { deleted: true, ref: "refs/tags/v1.0.0" }),
		).toEqual([]);
		expect(
			parseTagPushEvent(push, { after: zero, ref: "refs/tags/v1.0.0" }),
		).toEqual([]);
		expect(
			parseTagPushEvent(new Headers({ "x-github-event": "ping" }), {}),
		).toEqual([]);
		expect(
			parsePushEvent(push, { after: sha, ref: "refs/tags/v1.0.0" }),
		).toEqual([]);
	});
});

describe("parsePullRequestEvent", () => {
	const sha = "68c1b9e0f1a2b3c4d5e6f708192a3b4c5d6e7f80";

	function githubPayload(
		action: string,
		headRepo: unknown = { full_name: "acme/api" },
	) {
		return {
			action,
			number: 12,
			pull_request: {
				base: { repo: { full_name: "acme/api" } },
				head: { ref: "feature/x", repo: headRepo, sha },
				title: "Add x",
			},
		};
	}

	test("GitHub opened, synchronize and closed", () => {
		const headers = new Headers({ "x-github-event": "pull_request" });
		expect(parsePullRequestEvent(headers, githubPayload("opened"))).toEqual({
			action: "open",
			branch: "feature/x",
			commit: sha,
			fromFork: false,
			number: 12,
			title: "Add x",
		});
		expect(
			parsePullRequestEvent(headers, githubPayload("synchronize"))?.action,
		).toBe("update");
		expect(
			parsePullRequestEvent(headers, githubPayload("closed"))?.action,
		).toBe("close");
		expect(parsePullRequestEvent(headers, githubPayload("labeled"))).toBeNull();
	});

	test("GitHub fork, deleted fork and missing repos are forks", () => {
		const headers = new Headers({ "x-github-event": "pull_request" });
		expect(
			parsePullRequestEvent(
				headers,
				githubPayload("opened", { fork: true, full_name: "mallory/api" }),
			)?.fromFork,
		).toBe(true);
		expect(
			parsePullRequestEvent(headers, githubPayload("opened", null))?.fromFork,
		).toBe(true);
		expect(
			parsePullRequestEvent(headers, {
				action: "opened",
				number: 1,
				pull_request: { head: { ref: "x", sha } },
			})?.fromFork,
		).toBe(true);
	});

	test("Gitea's synchronized action, same repo and fork", () => {
		const headers = new Headers({ "x-gitea-event": "pull_request" });
		const payload = (headRepo: string) => ({
			action: "synchronized",
			number: 3,
			pull_request: {
				base: { repo: { full_name: "team/app" } },
				head: { ref: "fix", repo: { full_name: headRepo }, sha },
				title: "Fix",
			},
		});
		const same = parsePullRequestEvent(headers, payload("team/app"));
		expect(same?.action).toBe("update");
		expect(same?.fromFork).toBe(false);
		expect(
			parsePullRequestEvent(headers, payload("someone/app"))?.fromFork,
		).toBe(true);
	});

	test("GitLab merge request hooks, merge closes, other projects are forks", () => {
		const headers = new Headers({ "x-gitlab-event": "Merge Request Hook" });
		const attributes = {
			action: "open",
			iid: 7,
			last_commit: { id: sha },
			source_branch: "mr-branch",
			source_project_id: 42,
			target_project_id: 42,
			title: "MR",
		};
		expect(
			parsePullRequestEvent(headers, { object_attributes: attributes }),
		).toEqual({
			action: "open",
			branch: "mr-branch",
			commit: sha,
			fromFork: false,
			number: 7,
			title: "MR",
		});
		expect(
			parsePullRequestEvent(headers, {
				object_attributes: { ...attributes, source_project_id: 99 },
			})?.fromFork,
		).toBe(true);
		const merged = parsePullRequestEvent(headers, {
			object_attributes: { action: "merge", iid: 7 },
		});
		expect(merged?.action).toBe("close");
		expect(merged?.fromFork).toBe(true);
	});

	test("Bitbucket builds the branch, other repositories are forks", () => {
		const headers = new Headers({ "x-event-key": "pullrequest:rejected" });
		const payload = (sourceRepo: string | null) => ({
			pullrequest: {
				destination: { repository: { full_name: "ws/api" } },
				id: 9,
				source: {
					branch: { name: "b" },
					commit: { hash: "abc123" },
					repository: sourceRepo ? { full_name: sourceRepo } : undefined,
				},
				title: "T",
			},
		});
		expect(parsePullRequestEvent(headers, payload("ws/api"))).toEqual({
			action: "close",
			branch: "b",
			commit: null,
			fromFork: false,
			number: 9,
			title: "T",
		});
		expect(parsePullRequestEvent(headers, payload("other/api"))?.fromFork).toBe(
			true,
		);
		expect(parsePullRequestEvent(headers, payload(null))?.fromFork).toBe(true);
	});

	test("a push isn't a pull request", () => {
		expect(
			parsePullRequestEvent(new Headers({ "x-github-event": "push" }), {}),
		).toBeNull();
	});
});

describe("previewSlug", () => {
	test("appends the pull request number", () => {
		expect(previewSlug("api", 12)).toBe("api-pr-12");
	});

	test("stays a 63 character DNS label", () => {
		const slug = previewSlug(`${"a".repeat(60)}-b`, 1234);
		expect(slug.length).toBeLessThanOrEqual(63);
		expect(slug.endsWith("-pr-1234")).toBe(true);
	});
});
