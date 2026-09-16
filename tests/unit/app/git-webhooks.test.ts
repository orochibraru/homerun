import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
	createWebhookRequest,
	deleteWebhookPath,
	gitWebhookUrl,
	parsePushEvent,
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
		expect(createWebhookRequest("github", "acme/api", url, secret).path).toBe(
			"/repos/acme/api/hooks",
		);
		expect(
			createWebhookRequest("gitlab", "group/sub/api", url, secret).path,
		).toBe("/projects/group%2Fsub%2Fapi/hooks");
		expect(
			createWebhookRequest("bitbucket", "ws/api", url, secret).body.events,
		).toEqual(["repo:push"]);
		expect(deleteWebhookPath("gitea", "acme/api", "7")).toBe(
			"/repos/acme/api/hooks/7",
		);
	});

	test("reads the new hook's id", () => {
		expect(webhookIdFrom("github", { id: 42 })).toBe("42");
		expect(webhookIdFrom("bitbucket", { uuid: "{abc}" })).toBe("{abc}");
		expect(webhookIdFrom("gitea", {})).toBeNull();
	});
});
