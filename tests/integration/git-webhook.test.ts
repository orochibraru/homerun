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

describe("git push webhooks", () => {
	beforeAll(async () => {
		const ctx = integrationContext();
		client = apiClient();
		cleanup = new ServiceCleanup(client);
		const { data, error, response } = await client.POST("/services", {
			body: {
				autoDeployOnPush: true,
				buildSource: "git",
				containerPort: 80,
				gitRef: "main",
				gitUrl: ctx.gitBuildFixtureUrl,
				name: "IT push deploy",
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
