import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { ServiceCleanup } from "./support/cleanup";
import type { ApiClient } from "./support/client";
import { nativeFetch } from "./support/config";
import { apiClient, integrationContext } from "./support/context";

interface WebhookFixture {
	origin: string;
	secret: string;
	serviceId: string;
}

let fixture: WebhookFixture;
let client: ApiClient;
let cleanup: ServiceCleanup;

function deliver(
	payload: Record<string, unknown>,
	signWith: string,
	event = "push",
): Promise<Response> {
	const body = JSON.stringify(payload);
	const signature = createHmac("sha256", signWith).update(body).digest("hex");
	return nativeFetch(
		`${fixture.origin}/api/v1/webhooks/git/${fixture.serviceId}`,
		{
			body,
			headers: {
				"content-type": "application/json",
				"x-github-event": event,
				"x-hub-signature-256": `sha256=${signature}`,
			},
			method: "POST",
		},
	);
}

function pullRequest(action: string): Record<string, unknown> {
	return {
		action,
		number: 7,
		pull_request: {
			base: { repo: { full_name: "acme/fixture" } },
			head: {
				ref: "main",
				repo: { full_name: "acme/fixture" },
				sha: "0123456789abcdef0123456789abcdef01234567",
			},
			title: "IT preview",
		},
	};
}

describe("git push webhooks", () => {
	beforeAll(async () => {
		const ctx = integrationContext();
		client = apiClient();
		cleanup = new ServiceCleanup(client);
		const { data, error, response } = await client.POST("/services", {
			body: {
				authRequired: false,
				autoDeployOnPush: true,
				buildSource: "git",
				capAdd: [],
				devices: [],
				envFiles: [],
				gitBuildMethod: "dockerfile",
				labels: {},
				privileged: false,
				containerPort: 80,
				dnsResolvable: false,
				envVars: {},
				gitRef: "main",
				gitUrl: ctx.gitBuildFixtureUrl,
				name: "IT push deploy",
				pullPolicy: "always",
				restartPolicy: "no",
				slug: `push-deploy-${Date.now().toString(36)}`,
			},
		});
		if (error || !data) {
			throw new Error(
				`Couldn't create the webhook fixture service: ${response.status} ${JSON.stringify(error)}`,
			);
		}

		const webhook = await client.GET("/services/{serviceId}/webhook", {
			params: { path: { serviceId: data.id } },
		});
		const secret = webhook.data?.secret;
		if (!secret) {
			throw new Error(
				`No webhook secret for the fixture service: ${webhook.response.status}`,
			);
		}
		cleanup.track(data.id);
		fixture = { origin: ctx.origin, secret, serviceId: data.id };
	});

	afterAll(async () => {
		await cleanup.cleanupAll();
	});

	test("the service gets a webhook secret and a reason it couldn't register one", async () => {
		const { data } = await client.GET("/services/{serviceId}/webhook", {
			params: { path: { serviceId: fixture.serviceId } },
		});
		expect(data?.registered).toBe(false);
		expect(data?.url).toBe(
			`${fixture.origin}/api/v1/webhooks/git/${fixture.serviceId}`,
		);
		expect(data?.error).toContain("add the webhook by hand");
	});

	test("a delivery with a bad signature is refused", async () => {
		const res = await deliver(
			{ after: "abc", ref: "refs/heads/main" },
			"not-the-secret",
		);
		expect(res.status).toBe(401);
	});

	test("a push to another branch is acknowledged and ignored", async () => {
		const res = await deliver(
			{ after: "abc", ref: "refs/heads/feature" },
			fixture.secret,
		);
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ ignored: "Not a push to main." });
	});

	test("a ping is acknowledged without deploying", async () => {
		const res = await deliver({ zen: "hi" }, fixture.secret, "ping");
		expect(res.status).toBe(202);
		expect((await res.json()).deploymentId).toBeUndefined();
	});

	test("a push to the service's branch enqueues a deploy", async () => {
		const res = await deliver(
			{ after: "abc", ref: "refs/heads/main" },
			fixture.secret,
		);
		expect(res.status).toBe(202);
		const { deploymentId, jobId } = await res.json();
		expect(deploymentId).toEqual(expect.any(String));

		const job = await client.GET("/jobs/{jobId}", {
			params: { path: { jobId } },
		});
		expect(job.response.status).toBe(200);
	});

	test("a pull request is ignored while previews are off", async () => {
		const res = await deliver(
			pullRequest("opened"),
			fixture.secret,
			"pull_request",
		);
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({
			ignored: "Pull request previews are off.",
		});
	});

	test("with previews on, an opened pull request deploys a preview once per head", async () => {
		const patched = await client.PATCH("/services/{serviceId}", {
			body: { previewsEnabled: true },
			params: { path: { serviceId: fixture.serviceId } },
		});
		expect(patched.response.status).toBe(200);

		const opened = await deliver(
			pullRequest("opened"),
			fixture.secret,
			"pull_request",
		);
		expect(opened.status).toBe(202);
		const { deploymentId } = await opened.json();
		expect(deploymentId).toEqual(expect.any(String));

		const again = await deliver(
			pullRequest("synchronize"),
			fixture.secret,
			"pull_request",
		);
		expect(again.status).toBe(202);
		expect((await again.json()).ignored).toContain("already builds");
	});

	test("an unknown service is a 404, not a deploy", async () => {
		const res = await nativeFetch(
			`${fixture.origin}/api/v1/webhooks/git/00000000-0000-0000-0000-000000000000`,
			{
				body: "{}",
				headers: { "content-type": "application/json" },
				method: "POST",
			},
		);
		expect(res.status).toBe(404);
	});
});
