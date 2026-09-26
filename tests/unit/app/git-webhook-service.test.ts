import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { config } = await import("../../../src/lib/config");
const { Logger } = await import("../../../src/lib/logger");
const { GitConnectionDTO } = await import(
	"../../../src/lib/dto/git-connection-dto"
);
const { InstanceSettingsDTO } = await import(
	"../../../src/lib/dto/instance-settings-dto"
);
const { ServiceGitDTO } = await import("../../../src/lib/dto/service-git-dto");
const { DeploymentService } = await import(
	"../../../src/lib/services/deploy.service"
);
const { GitProviderRefusedError, GitProviderService } = await import(
	"../../../src/lib/services/git-provider.service"
);
const { PreviewService } = await import(
	"../../../src/lib/services/preview.service"
);
const { ReleaseChannelError, ReleaseChannelService } = await import(
	"../../../src/lib/services/release-channel.service"
);
const { decryptSecret, encryptSecret } = await import(
	"../../../src/lib/services/secrets"
);
const { GitWebhookService } = await import(
	"../../../src/lib/services/git-webhook.service"
);

type Svc = Parameters<typeof GitWebhookService.sync>[0];

const SECRET = "s3cret";
const PROVIDER = {
	enabled: true,
	id: "gh",
	kind: "github",
	name: "GitHub",
};

function fakeService(overrides: Record<string, unknown> = {}) {
	const updates: Record<string, unknown>[] = [];
	const svc: Record<string, unknown> = {
		autoDeployOnPush: true,
		buildSource: "git",
		gitPollEnabled: false,
		gitProviderId: "gh",
		gitRef: "main",
		gitRepo: "me/app",
		gitUrl: "https://github.com/me/app.git",
		gitWebhookError: null,
		gitWebhookId: null,
		gitWebhookReconnect: false,
		gitWebhookSecretEnc: encryptSecret(SECRET),
		id: "svc1",
		previewParentId: null,
		previewsEnabled: false,
		toJSON() {
			return svc;
		},
		update: async (patch: Record<string, unknown>) => {
			updates.push(patch);
			Object.assign(svc, patch);
		},
		userId: "u1",
		...overrides,
	};
	return { svc: svc as unknown as Svc, state: svc, updates };
}

let providers: Record<string, unknown>[] = [];
let connection: unknown = { id: "conn" };
let createError: unknown = null;
let deleteError: unknown = null;
let created: unknown[][] = [];
let deleted: unknown[][] = [];
let enqueued: unknown[] = [];
let warnings: string[] = [];
const originalOrigin = config.auth.origin;

beforeEach(() => {
	providers = [PROVIDER];
	connection = { id: "conn" };
	createError = null;
	deleteError = null;
	created = [];
	deleted = [];
	enqueued = [];
	warnings = [];
	config.auth.origin = "https://homerun.example.com";
	stub(Logger.prototype, "info", () => undefined);
	stub(Logger.prototype, "warn", (message: string) => {
		warnings.push(message);
	});
	stub(InstanceSettingsDTO, "get", async () => ({ gitProviders: providers }));
	stub(GitConnectionDTO, "getForUserAndProvider", async () => connection);
	stub(GitProviderService, "createPushWebhook", async (...args: unknown[]) => {
		if (createError) {
			throw createError;
		}
		created.push(args);
		return "hook-1";
	});
	stub(GitProviderService, "deletePushWebhook", async (...args: unknown[]) => {
		if (deleteError) {
			throw deleteError;
		}
		deleted.push(args);
	});
	stub(DeploymentService, "enqueueDeploy", async (input: unknown) => {
		enqueued.push(input);
		return { deploymentId: "d1", jobId: "j1" };
	});
});

afterEach(() => {
	config.auth.origin = originalOrigin;
	restoreStubs();
});

const snapshot = {
	gitProviderId: "gh",
	gitRepo: "me/app",
	gitWebhookId: null,
};

describe("GitWebhookService.sync", () => {
	test("registers a webhook with the provider", async () => {
		const { svc, state } = fakeService({ gitWebhookSecretEnc: null });
		await GitWebhookService.sync(svc, snapshot);
		expect(created).toHaveLength(1);
		expect(created[0][2]).toMatchObject({
			pullRequests: false,
			repo: "me/app",
			url: "https://homerun.example.com/api/v1/webhooks/git/svc1",
		});
		expect(state.gitWebhookId).toBe("hook-1");
		expect(state.gitWebhookError).toBeNull();
		expect(decryptSecret(state.gitWebhookSecretEnc as string)).toHaveLength(48);
	});

	test("keeps the existing secret and hook when nothing moved", async () => {
		const { svc, state } = fakeService({ gitWebhookId: "hook-0" });
		await GitWebhookService.sync(svc, { ...snapshot, gitWebhookId: "hook-0" });
		expect(created).toHaveLength(0);
		expect(deleted).toHaveLength(0);
		expect(decryptSecret(state.gitWebhookSecretEnc as string)).toBe(SECRET);
	});

	test("removes the hook and secret when push and previews are both off", async () => {
		const { svc, state } = fakeService({
			autoDeployOnPush: false,
			gitWebhookId: "hook-0",
		});
		await GitWebhookService.sync(svc, { ...snapshot, gitWebhookId: "hook-0" });
		expect(deleted[0].slice(2)).toEqual(["me/app", "hook-0"]);
		expect(state.gitWebhookId).toBeNull();
		expect(state.gitWebhookSecretEnc).toBeNull();
	});

	test("moves the hook when the repo changed", async () => {
		const { svc, state } = fakeService({
			gitRepo: "me/other",
			gitWebhookId: "hook-0",
		});
		await GitWebhookService.sync(svc, { ...snapshot, gitWebhookId: "hook-0" });
		expect(deleted[0].slice(2)).toEqual(["me/app", "hook-0"]);
		expect(created[0][2]).toMatchObject({ repo: "me/other" });
		expect(state.gitWebhookId).toBe("hook-1");
	});

	test("re-registers when previews are toggled", async () => {
		const { svc } = fakeService({
			gitWebhookId: "hook-0",
			previewsEnabled: true,
		});
		await GitWebhookService.sync(svc, {
			...snapshot,
			gitWebhookId: "hook-0",
			previewsEnabled: false,
		});
		expect(deleted).toHaveLength(1);
		expect(created[0][2]).toMatchObject({ pullRequests: true });
	});

	test("re-registers with tag pushes when release channels are toggled", async () => {
		const { svc } = fakeService({
			autoDeployOnPush: false,
			channelsEnabled: true,
			gitWebhookId: "hook-0",
		});
		await GitWebhookService.sync(svc, {
			...snapshot,
			channelsEnabled: false,
			gitWebhookId: "hook-0",
		});
		expect(deleted).toHaveLength(1);
		expect(created[0][2]).toMatchObject({ tags: true });
	});

	test("logs rather than throws when the provider refuses a delete", async () => {
		deleteError = new Error("nope");
		const { svc, state } = fakeService({ autoDeployOnPush: false });
		await GitWebhookService.sync(svc, { ...snapshot, gitWebhookId: "hook-0" });
		expect(warnings.some((w) => w.includes("Couldn't remove"))).toBe(true);
		expect(state.gitWebhookId).toBeNull();
	});

	test("skips the delete when the provider is gone", async () => {
		providers = [];
		const { svc } = fakeService({ autoDeployOnPush: false });
		await GitWebhookService.sync(svc, { ...snapshot, gitWebhookId: "hook-0" });
		expect(deleted).toHaveLength(0);
	});

	test("never wants a webhook on a preview or an image service", async () => {
		const preview = fakeService({ previewParentId: "parent" });
		await GitWebhookService.sync(preview.svc, snapshot);
		expect(preview.state.gitWebhookSecretEnc).toBeNull();
		const image = fakeService({ buildSource: "image" });
		await GitWebhookService.sync(image.svc, snapshot);
		expect(created).toHaveLength(0);
	});

	test("asks for a dashboard URL when there's no origin", async () => {
		config.auth.origin = undefined;
		const { svc, state } = fakeService();
		await GitWebhookService.sync(svc, snapshot);
		expect(state.gitWebhookError).toContain("Dashboard URL");
		expect(state.gitWebhookReconnect).toBe(false);
	});

	test("asks to add the hook by hand without a provider", async () => {
		const { svc, state } = fakeService({ gitProviderId: null });
		await GitWebhookService.sync(svc, { ...snapshot, gitProviderId: null });
		expect(state.gitWebhookError).toContain("by hand");
		expect(await GitWebhookService.describe(svc)).toMatchObject({
			providerName: null,
			reconnect: null,
		});
	});

	test("asks to reconnect when the owner has no connection", async () => {
		connection = null;
		const { svc, state } = fakeService();
		await GitWebhookService.sync(svc, snapshot);
		expect(state.gitWebhookError).toBe(
			"The service's owner isn't connected to GitHub any more.",
		);
		expect(state.gitWebhookReconnect).toBe(true);
	});

	test("records a provider refusal and whether reconnecting helps", async () => {
		createError = new GitProviderRefusedError("missing scope", 403, true);
		const { svc, state } = fakeService();
		await GitWebhookService.sync(svc, snapshot);
		expect(state.gitWebhookError).toBe("missing scope");
		expect(state.gitWebhookReconnect).toBe(true);
	});

	test("falls back to a generic message for a non-Error failure", async () => {
		createError = "weird";
		const { svc, state } = fakeService();
		await GitWebhookService.sync(svc, snapshot);
		expect(state.gitWebhookError).toBe("Couldn't register the webhook.");
		expect(state.gitWebhookReconnect).toBe(false);
	});
});

describe("GitWebhookService.retryAfterReconnect", () => {
	test("syncs every waiting service and survives one failing", async () => {
		const good = fakeService({ id: "good" });
		const bad = fakeService({ id: "bad" });
		stub(bad.state, "update", async () => {
			throw new Error("db down");
		});
		stub(ServiceGitDTO, "listAwaitingWebhook", async () => [bad.svc, good.svc]);
		await GitWebhookService.retryAfterReconnect("u1", "gh");
		expect(good.state.gitWebhookId).toBe("hook-1");
		expect(warnings.some((w) => w.includes("service=bad"))).toBe(true);
	});
});

describe("GitWebhookService.describe", () => {
	test("returns null when no webhook is wanted", async () => {
		const { svc } = fakeService({ autoDeployOnPush: false });
		expect(await GitWebhookService.describe(svc)).toBeNull();
	});

	test("returns null without a secret", async () => {
		const { svc } = fakeService({ gitWebhookSecretEnc: null });
		expect(await GitWebhookService.describe(svc)).toBeNull();
	});

	test("describes a registered hook", async () => {
		const { svc } = fakeService({ gitWebhookId: "hook-1" });
		expect(await GitWebhookService.describe(svc)).toEqual({
			error: null,
			polling: false,
			providerName: "GitHub",
			reconnect: null,
			registered: true,
			secret: SECRET,
			url: "https://homerun.example.com/api/v1/webhooks/git/svc1",
		});
	});

	test("offers a reconnect and polling for an unregistered hook", async () => {
		config.auth.origin = undefined;
		const { svc } = fakeService({
			gitWebhookError: "missing scope",
			gitWebhookReconnect: true,
		});
		expect(await GitWebhookService.describe(svc)).toMatchObject({
			error: "missing scope",
			polling: true,
			reconnect: { providerId: "gh", providerName: "GitHub" },
			registered: false,
			url: null,
		});
	});

	test("never polls a pinned commit", async () => {
		const { svc } = fakeService({ gitRef: "a".repeat(40) });
		expect((await GitWebhookService.describe(svc))?.polling).toBe(false);
	});
});

describe("GitWebhookService.remove", () => {
	test("deletes a registered hook", async () => {
		const { svc } = fakeService({ gitWebhookId: "hook-1" });
		await GitWebhookService.remove(svc);
		expect(deleted[0].slice(2)).toEqual(["me/app", "hook-1"]);
	});

	test("does nothing without a hook", async () => {
		const { svc } = fakeService();
		await GitWebhookService.remove(svc);
		expect(deleted).toHaveLength(0);
	});
});

function signed(event: string, body: unknown, secret = SECRET) {
	const raw = JSON.stringify(body);
	const signature = createHmac("sha256", secret).update(raw).digest("hex");
	return {
		headers: new Headers({
			"x-github-event": event,
			"x-hub-signature-256": `sha256=${signature}`,
		}),
		raw,
	};
}

describe("GitWebhookService.handleDelivery", () => {
	test("rejects a delivery for no service", async () => {
		const result = await GitWebhookService.handleDelivery(
			null,
			new Headers(),
			"{}",
		);
		expect(result).toMatchObject({ code: 404, status: "rejected" });
	});

	test("rejects a bad signature", async () => {
		const { svc } = fakeService();
		const { headers, raw } = signed("push", {}, "wrong");
		const result = await GitWebhookService.handleDelivery(svc, headers, raw);
		expect(result).toMatchObject({ code: 401, status: "rejected" });
	});

	test("rejects a body that isn't JSON", async () => {
		const { svc } = fakeService();
		const raw = "not json";
		const signature = createHmac("sha256", SECRET).update(raw).digest("hex");
		const headers = new Headers({
			"x-hub-signature-256": `sha256=${signature}`,
		});
		const result = await GitWebhookService.handleDelivery(svc, headers, raw);
		expect(result).toMatchObject({ code: 400, status: "rejected" });
	});

	test("deploys a push to the built branch", async () => {
		const { svc, state } = fakeService();
		const { headers, raw } = signed("push", {
			after: "b".repeat(40),
			ref: "refs/heads/main",
		});
		const result = await GitWebhookService.handleDelivery(svc, headers, raw);
		expect(result).toEqual({
			deploymentId: "d1",
			jobId: "j1",
			status: "deployed",
		});
		expect(state.gitLastSeenCommit).toBe("b".repeat(40));
		expect(enqueued).toEqual([
			expect.objectContaining({ trigger: "push", userId: "u1" }),
		]);
	});

	test("deploys a push with no commit without recording one", async () => {
		const { svc, updates } = fakeService({
			gitProviderId: null,
			gitRef: null,
		});
		const { headers, raw } = signed("push", { ref: "refs/heads/main" });
		const result = await GitWebhookService.handleDelivery(svc, headers, raw);
		expect(result.status).toBe("deployed");
		expect(updates).toHaveLength(0);
	});

	test("ignores a push to another branch", async () => {
		const { svc } = fakeService();
		const { headers, raw } = signed("push", { ref: "refs/heads/dev" });
		const result = await GitWebhookService.handleDelivery(svc, headers, raw);
		expect(result).toEqual({
			reason: "Not a push to main.",
			status: "ignored",
		});
		expect(enqueued).toHaveLength(0);
	});

	const pullRequest = {
		action: "opened",
		number: 3,
		pull_request: {
			base: { repo: { full_name: "me/app" } },
			head: {
				ref: "feature",
				repo: { full_name: "me/app" },
				sha: "c".repeat(40),
			},
			title: "Feature",
		},
	};

	test("hands a pull request to previews when they're on", async () => {
		const handled: unknown[] = [];
		stub(PreviewService, "handle", async (_svc: unknown, event: unknown) => {
			handled.push(event);
			return { deploymentId: "d2", jobId: "j2", status: "deployed" };
		});
		const { svc } = fakeService({ previewsEnabled: true });
		const { headers, raw } = signed("pull_request", pullRequest);
		const result = await GitWebhookService.handleDelivery(svc, headers, raw);
		expect(result).toMatchObject({ deploymentId: "d2", status: "deployed" });
		expect(handled[0]).toMatchObject({ action: "open", number: 3 });
	});

	test("ignores a pull request when previews are off", async () => {
		const { svc } = fakeService();
		const { headers, raw } = signed("pull_request", pullRequest);
		const result = await GitWebhookService.handleDelivery(svc, headers, raw);
		expect(result).toEqual({
			reason: "Pull request previews are off.",
			status: "ignored",
		});
	});

	describe("with release channels on", () => {
		const channels = {
			channelBranch: "main",
			channelsEnabled: true,
			channelTagPattern: "v*",
			gitRef: "v1.0.0",
		};
		let canaryCalls: unknown[][] = [];
		let stableCalls: unknown[][] = [];
		let canaryError: unknown = null;

		beforeEach(() => {
			canaryCalls = [];
			stableCalls = [];
			canaryError = null;
			stub(
				ReleaseChannelService,
				"deployCanary",
				async (...args: unknown[]) => {
					if (canaryError) {
						throw canaryError;
					}
					canaryCalls.push(args);
					return {
						deploymentId: "dc",
						jobId: "jc",
						serviceId: "canary1",
						status: "deployed",
					};
				},
			);
			stub(
				ReleaseChannelService,
				"deployStable",
				async (...args: unknown[]) => {
					stableCalls.push(args);
					return {
						deploymentId: "ds",
						jobId: "js",
						serviceId: "svc1",
						status: "deployed",
					};
				},
			);
		});

		test("a push to the canary branch deploys the canary, not the service", async () => {
			const { svc } = fakeService(channels);
			const { headers, raw } = signed("push", {
				after: "b".repeat(40),
				ref: "refs/heads/main",
			});
			const result = await GitWebhookService.handleDelivery(svc, headers, raw);
			expect(result).toMatchObject({
				serviceId: "canary1",
				status: "deployed",
			});
			expect(canaryCalls[0][1]).toEqual({
				commit: "b".repeat(40),
				trigger: "push",
				userId: "u1",
			});
			expect(enqueued).toHaveLength(0);
		});

		test("a matching tag deploys the stable service at that tag", async () => {
			const { svc } = fakeService(channels);
			const { headers, raw } = signed("push", {
				after: "c".repeat(40),
				ref: "refs/tags/v1.1.0",
			});
			const result = await GitWebhookService.handleDelivery(svc, headers, raw);
			expect(result).toMatchObject({ serviceId: "svc1", status: "deployed" });
			expect(stableCalls[0][1]).toEqual({
				tag: "v1.1.0",
				trigger: "push",
				userId: "u1",
			});
			expect(canaryCalls).toHaveLength(0);
		});

		test("a tag outside the pattern and other branches are ignored", async () => {
			const { svc } = fakeService(channels);
			for (const ref of ["refs/tags/nightly-3", "refs/heads/dev"]) {
				const { headers, raw } = signed("push", { ref });
				expect(
					(await GitWebhookService.handleDelivery(svc, headers, raw)).status,
				).toBe("ignored");
			}
			expect(canaryCalls).toHaveLength(0);
			expect(stableCalls).toHaveLength(0);
		});

		test("a canary that can't be deployed is reported, not thrown", async () => {
			canaryError = new ReleaseChannelError("slug taken");
			const { svc } = fakeService(channels);
			const { headers, raw } = signed("push", { ref: "refs/heads/main" });
			expect(await GitWebhookService.handleDelivery(svc, headers, raw)).toEqual(
				{ reason: "slug taken", status: "ignored" },
			);
		});
	});

	test("accepts any signature scheme for a repo off a known host", async () => {
		const { svc } = fakeService({
			gitProviderId: null,
			gitUrl: null,
		});
		const { headers, raw } = signed("push", { ref: "refs/heads/main" });
		const result = await GitWebhookService.handleDelivery(svc, headers, raw);
		expect(result.status).toBe("deployed");
	});
});
