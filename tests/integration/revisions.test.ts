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

async function createService(name: string, tag: string): Promise<string> {
	const created = await client.POST("/services", {
		body: {
			authRequired: false,
			buildSource: "image",
			containerPort: 80,
			dnsResolvable: false,
			envVars: {},
			image: "nginx",
			name,
			restartPolicy: "unless-stopped",
			slug: slug(name.toLowerCase().replaceAll(" ", "-")),
			tag,
		},
	});
	const svc = expectOk(created.data, created.response);
	const id = cleanup.track(svc.id);
	await patch(id, { imageScanEnabled: false });
	return id;
}

async function patch(
	serviceId: string,
	body: {
		autoRollback?: boolean;
		healthcheckCommand?: string | null;
		image?: string;
		imageScanEnabled?: boolean;
		tag?: string;
	},
) {
	const res = await client.PATCH("/services/{serviceId}", {
		body,
		params: { path: { serviceId } },
	});
	return expectOk(res.data, res.response);
}

async function deploy(serviceId: string): Promise<string> {
	const res = await client.POST("/services/{serviceId}/deploy", {
		params: { path: { serviceId } },
	});
	const result = expectOk(res.data, res.response);
	if (!result.success) {
		throw new Error(`Deploy failed: ${result.error}`);
	}
	return result.deploymentId;
}

async function revisions(serviceId: string) {
	const res = await client.GET("/services/{serviceId}/revisions", {
		params: { path: { serviceId } },
	});
	return expectOk(res.data, res.response);
}

async function containerImage(serviceId: string): Promise<string> {
	const res = await client.GET("/services/{serviceId}", {
		params: { path: { serviceId } },
	});
	const svc = expectOk(res.data, res.response);
	const proc = Bun.spawn(
		[
			"docker",
			"inspect",
			"--format",
			"{{.Config.Image}}",
			svc.containerId ?? "",
		],
		{ stdout: "pipe" },
	);
	return (await new Response(proc.stdout).text()).trim();
}

async function waitFor<T>(
	read: () => Promise<T>,
	done: (value: T) => boolean,
	timeoutMs: number,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let last = await read();
	while (!done(last)) {
		if (Date.now() > deadline) {
			throw new Error(`Timed out, last value: ${JSON.stringify(last)}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
		last = await read();
	}
	return last;
}

describe("revisions : list and roll back", () => {
	test("two image deploys become two revisions, rollback runs the old digest", async () => {
		const id = await createService("IT revisions", "1.27-alpine");
		const first = await deploy(id);
		await patch(id, { tag: "1.26-alpine" });
		const second = await deploy(id);

		const listed = await revisions(id);
		expect(listed.map((row) => row.id)).toEqual([second, first]);
		expect(listed[0]?.current).toBe(true);
		expect(listed[1]?.previous).toBe(true);
		expect(listed[1]?.imageRef).toBe("nginx:1.27-alpine");
		expect(listed[1]?.imageDigest).toMatch(/^sha256:/);
		expect(listed.every((row) => row.retained)).toBe(true);

		const rolled = await client.POST(
			"/services/{serviceId}/revisions/{revisionId}/deploy",
			{ params: { path: { revisionId: "previous", serviceId: id } } },
		);
		expect(expectOk(rolled.data, rolled.response).success).toBe(true);

		const after = await revisions(id);
		expect(after[0]?.rollbackOfDeploymentId).toBe(first);
		expect(after[0]?.current).toBe(true);
		expect(after[0]?.imageDigest).toBe(listed[1]?.imageDigest ?? "");
		expect(await containerImage(id)).toBe(
			`nginx:1.27-alpine@${listed[1]?.imageDigest}`,
		);
		const svc = await client.GET("/services/{serviceId}", {
			params: { path: { serviceId: id } },
		});
		expect(expectOk(svc.data, svc.response).tag).toBe("1.27-alpine");
	}, 240_000);

	test("an unknown revision is a 404, and a single revision has no previous", async () => {
		const id = await createService("IT revisions single", "1.27-alpine");
		await deploy(id);
		const missing = await client.POST(
			"/services/{serviceId}/revisions/{revisionId}/deploy",
			{ params: { path: { revisionId: "nope", serviceId: id } } },
		);
		expect(missing.response.status).toBe(404);
		const none = await client.POST(
			"/services/{serviceId}/revisions/{revisionId}/deploy",
			{ params: { path: { revisionId: "previous", serviceId: id } } },
		);
		expect(none.response.status).toBe(400);
	}, 120_000);
});

describe("revisions : auto-rollback", () => {
	test("a restart-looping revision is rolled back to the previous one", async () => {
		const id = await createService("IT auto rollback", "1.27-alpine");
		const good = await deploy(id);
		await patch(id, {
			autoRollback: true,
			image: "hello-world",
			tag: "latest",
		});
		const bad = await deploy(id);

		const settled = await waitFor(
			() => revisions(id),
			(rows) => rows[0]?.rollbackOfDeploymentId === good,
			120_000,
		);
		expect(settled.find((row) => row.id === bad)?.health).toBe("rolled_back");
		expect(await containerImage(id)).toStartWith("nginx:1.27-alpine@sha256:");
	}, 240_000);

	test("with auto-rollback off an unhealthy revision is only marked", async () => {
		const id = await createService("IT unhealthy", "1.27-alpine");
		await deploy(id);
		await patch(id, { image: "hello-world", tag: "latest" });
		const bad = await deploy(id);

		const settled = await waitFor(
			() => revisions(id),
			(rows) => rows.find((row) => row.id === bad)?.health === "unhealthy",
			120_000,
		);
		expect(settled[0]?.id).toBe(bad);
	}, 240_000);
});
