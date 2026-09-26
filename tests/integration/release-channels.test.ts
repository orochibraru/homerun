import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { ServiceCleanup } from "./support/cleanup";
import type { ApiClient } from "./support/client";
import { nativeFetch } from "./support/config";
import { apiClient, integrationContext } from "./support/context";

let client: ApiClient;
let cleanup: ServiceCleanup;
let origin: string;
let serviceId: string;
let secret: string;

function deliver(ref: string): Promise<Response> {
	const body = JSON.stringify({ after: "a".repeat(40), ref });
	const signature = createHmac("sha256", secret).update(body).digest("hex");
	return nativeFetch(`${origin}/api/v1/webhooks/git/${serviceId}`, {
		body,
		headers: {
			"content-type": "application/json",
			"x-github-event": "push",
			"x-hub-signature-256": `sha256=${signature}`,
		},
		method: "POST",
	});
}

async function environmentOf(id: string, deploymentId: string) {
	const { data } = await client.GET("/services/{serviceId}/deployments", {
		params: { path: { serviceId: id }, query: { limit: "50" } },
	});
	return data?.find((dep) => dep.id === deploymentId)?.environment;
}

describe("release channels", () => {
	beforeAll(async () => {
		const ctx = integrationContext();
		client = apiClient();
		cleanup = new ServiceCleanup(client);
		origin = ctx.origin;
		const { data, error, response } = await client.POST("/services", {
			body: {
				authRequired: false,
				autoDeployOnPush: true,
				buildSource: "git",
				capAdd: [],
				containerPort: 80,
				devices: [],
				dnsResolvable: false,
				envFiles: [],
				envVars: {},
				gitBuildMethod: "dockerfile",
				gitRef: "main",
				gitUrl: ctx.gitBuildFixtureUrl,
				labels: {},
				name: "IT channels",
				privileged: false,
				pullPolicy: "always",
				restartPolicy: "no",
				slug: `channels-${Date.now().toString(36)}`,
			},
		});
		if (error || !data) {
			throw new Error(
				`Couldn't create the channels fixture: ${response.status} ${JSON.stringify(error)}`,
			);
		}
		serviceId = cleanup.track(data.id);
		const webhook = await client.GET("/services/{serviceId}/webhook", {
			params: { path: { serviceId } },
		});
		secret = webhook.data?.secret ?? "";
	});

	afterAll(async () => {
		await cleanup.cleanupAll();
	});

	test("they're off by default and a canary deploy is refused", async () => {
		const { data } = await client.GET("/services/{serviceId}/channels", {
			params: { path: { serviceId } },
		});
		expect(data).toMatchObject({
			canary: null,
			enabled: false,
			tagPattern: "v*",
		});
		const deploy = await client.POST("/services/{serviceId}/deploy", {
			body: { environment: "canary" },
			params: { path: { serviceId } },
		});
		expect(deploy.response.status).toBe(400);
	});

	test("a bad tag pattern is refused", async () => {
		const { response } = await client.PATCH("/services/{serviceId}/channels", {
			body: { enabled: true, tagPattern: "v 1" },
			params: { path: { serviceId } },
		});
		expect(response.status).toBe(400);
	});

	test("turning them on creates the canary, routes pushes and tags, and off deletes it", async () => {
		const { data } = await client.PATCH("/services/{serviceId}/channels", {
			body: { branch: "main", enabled: true, tagPattern: "v*" },
			params: { path: { serviceId } },
		});
		const canaryId = data?.canary?.id ?? "";
		expect(data?.enabled).toBe(true);
		expect(data?.canary?.slug).toEndWith("-canary");
		expect(data?.canary?.gitRef).toBe("main");

		const push = await deliver("refs/heads/main");
		expect(push.status).toBe(202);
		const pushed = await push.json();
		expect(await environmentOf(canaryId, pushed.deploymentId)).toBe("canary");

		const tag = await deliver("refs/tags/v1.0.0");
		expect(tag.status).toBe(202);
		const tagged = await tag.json();
		expect(await environmentOf(serviceId, tagged.deploymentId)).toBe(
			"production",
		);
		const svc = await client.GET("/services/{serviceId}", {
			params: { path: { serviceId } },
		});
		expect(svc.data?.gitRef).toBe("v1.0.0");

		const ignored = await deliver("refs/tags/nightly");
		expect(await ignored.json()).toHaveProperty("ignored");

		const off = await client.PATCH("/services/{serviceId}/channels", {
			body: { enabled: false },
			params: { path: { serviceId } },
		});
		expect(off.data).toMatchObject({ canary: null, enabled: false });
		const gone = await client.GET("/services/{serviceId}", {
			params: { path: { serviceId: canaryId } },
		});
		expect(gone.response.status).toBe(404);
	});
});
