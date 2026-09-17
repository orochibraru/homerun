import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import { ServiceCleanup } from "./support/cleanup";
import type { ApiClient } from "./support/client";
import { apiClient } from "./support/context";

let client: ApiClient;
let cleanup: ServiceCleanup;

beforeAll(() => {
	client = apiClient();
	cleanup = new ServiceCleanup(client);
});

afterAll(async () => {
	await cleanup.cleanupAll();
});

function slug(name: string): string {
	return `it-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function createService(name: string): Promise<string> {
	const created = await client.POST("/services", {
		body: {
			authRequired: false,
			autoDeployOnPush: false,
			buildSource: "image",
			containerPort: 80,
			dnsResolvable: false,
			envVars: {},
			image: "nginx",
			name,
			pullPolicy: "always",
			restartPolicy: "no",
			slug: slug(name.toLowerCase().replaceAll(" ", "-")),
			tag: "alpine",
		},
	});
	const svc = expectOk(created.data, created.response);
	return cleanup.track(svc.id);
}

async function waitForJob(jobId: string, timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const res = await client.GET("/jobs/{jobId}", {
			params: { path: { jobId } },
		});
		const job = expectOk(res.data, res.response);
		if (["succeeded", "failed", "cancelled"].includes(job.status)) {
			return job;
		}
		await new Promise((r) => setTimeout(r, 2000));
	}
	throw new Error(`Job ${jobId} didn't finish within ${timeoutMs}ms`);
}

describe("image scans API", () => {
	test("an undeployed service has no scans and can't be scanned", async () => {
		const serviceId = await createService("IT scans empty");

		const listed = await client.GET("/services/{serviceId}/scans", {
			params: { path: { serviceId } },
		});
		expect(expectOk(listed.data, listed.response)).toEqual([]);
		expect(listed.response.headers.get("x-total-count")).toBe("0");

		const latest = await client.GET("/services/{serviceId}/scans/latest", {
			params: { path: { serviceId } },
		});
		expect(latest.response.status).toBe(404);

		const byId = await client.GET("/services/{serviceId}/scans/{scanId}", {
			params: { path: { scanId: "does-not-exist", serviceId } },
		});
		expect(byId.response.status).toBe(404);

		const queued = await client.POST("/services/{serviceId}/scans", {
			params: { path: { serviceId } },
		});
		expect(queued.response.status).toBe(400);
	});

	test("unknown services and jobs are 404", async () => {
		const listed = await client.GET("/services/{serviceId}/scans", {
			params: { path: { serviceId: "does-not-exist" } },
		});
		expect(listed.response.status).toBe(404);

		const queued = await client.POST("/services/{serviceId}/scans", {
			params: { path: { serviceId: "does-not-exist" } },
		});
		expect(queued.response.status).toBe(404);

		const job = await client.GET("/jobs/{jobId}", {
			params: { path: { jobId: "does-not-exist" } },
		});
		expect(job.response.status).toBe(404);
	});

	test("scanning a deployed service queues a job and records a scan", async () => {
		const serviceId = await createService("IT scans deployed");
		const deployed = await client.POST("/services/{serviceId}/deploy", {
			params: { path: { serviceId } },
		});
		expect(expectOk(deployed.data, deployed.response).success).toBe(true);

		const queued = await client.POST("/services/{serviceId}/scans", {
			params: { path: { serviceId } },
		});
		expect(queued.response.status).toBe(202);
		const { jobId } = expectOk(queued.data, queued.response);

		const again = await client.POST("/services/{serviceId}/scans", {
			params: { path: { serviceId } },
		});
		if (again.response.status === 409) {
			expect(again.error).toMatchObject({ jobId });
		} else {
			expect(again.response.status).toBe(202);
		}

		const job = await waitForJob(jobId, 540_000);
		expect(["succeeded", "failed"]).toContain(job.status);

		const latest = await client.GET("/services/{serviceId}/scans/latest", {
			params: { path: { serviceId } },
		});
		const scan = expectOk(latest.data, latest.response);
		expect(scan.serviceId).toBe(serviceId);
		expect(Array.isArray(scan.findings)).toBe(true);
		expect(scan.status).toBe(job.status === "succeeded" ? "ok" : "failed");

		const listed = await client.GET("/services/{serviceId}/scans", {
			params: { path: { serviceId } },
		});
		const summaries = expectOk(listed.data, listed.response);
		expect(summaries[0]?.id).toBe(scan.id);
		expect(summaries[0]).not.toHaveProperty("findings");

		const byId = await client.GET("/services/{serviceId}/scans/{scanId}", {
			params: { path: { scanId: scan.id, serviceId } },
		});
		expect(expectOk(byId.data, byId.response).id).toBe(scan.id);
	}, 600_000);
});
