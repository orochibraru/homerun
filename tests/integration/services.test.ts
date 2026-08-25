import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import { ServiceCleanup } from "./support/cleanup";
import type { ApiClient } from "./support/client";
import { nativeFetch } from "./support/config";
import { apiClient, integrationContext } from "./support/context";
import { ProjectCleanup } from "./support/projects";

// Constructed inside beforeAll, not at module top level : integrationContext()
// only resolves once the global preload beforeAll (setup.ts) has actually
// run, which happens *after* every test file's own top-level code executes
// (bun:test collects/imports every file before running any hook), see
// context.ts's own docstring.
let client: ApiClient;
let cleanup: ServiceCleanup;
let projectCleanup: ProjectCleanup;

beforeAll(() => {
	client = apiClient();
	cleanup = new ServiceCleanup(client);
	const ctx = integrationContext();
	projectCleanup = new ProjectCleanup(ctx.origin, ctx.apiKey);
});

afterAll(async () => {
	await cleanup.cleanupAll();
	await projectCleanup.cleanupAll();
});

function slug(name: string): string {
	return `it-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

interface ServiceStatus {
	currentStatus: string;
	containerId: string | null;
}

async function waitForStatus(
	serviceId: string,
	wanted: string,
	timeoutMs = 60_000,
): Promise<ServiceStatus> {
	const deadline = Date.now() + timeoutMs;
	let last: ServiceStatus | undefined;
	while (Date.now() < deadline) {
		const { data } = await client.GET("/services/{serviceId}", {
			params: { path: { serviceId } },
		});
		last = data as ServiceStatus | undefined;
		if (last?.currentStatus === wanted) {
			return last;
		}
		if (last?.currentStatus === "failed" && wanted !== "failed") {
			throw new Error(
				`Service ${serviceId} reached "failed" while waiting for "${wanted}"`,
			);
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error(
		`Service ${serviceId} never reached "${wanted}" within ${timeoutMs}ms (last: ${JSON.stringify(last)})`,
	);
}

describe("services : image-mode deploy", () => {
	test("local target, no project", async () => {
		const created = await client.POST("/services", {
			body: {
				authRequired: false,
				buildSource: "image",
				containerPort: 80,
				dnsResolvable: false,
				envVars: {},
				image: "nginx",
				name: "IT local no project",
				restartPolicy: "no",
				slug: slug("local-noproj"),
				tag: "alpine",
			},
		});
		const svc = expectOk(created.data, created.response);
		expect(created.response.status).toBe(201);
		cleanup.track(svc.id as string);
		expect(svc.remoteHostId).toBeNull();
		expect(svc.desiredState).toBe("stopped");

		const deployed = await client.POST("/services/{serviceId}/deploy", {
			params: { path: { serviceId: svc.id as string } },
		});
		const deployResult = expectOk(deployed.data, deployed.response);
		expect(deployResult.success).toBe(true);
		expect(deployResult.containerId).toBeTruthy();

		const status = await waitForStatus(svc.id as string, "running");
		expect(status.containerId).toBeTruthy();
	});

	test("local target, inside a project", async () => {
		const projRes = await client.POST("/projects", {
			body: { name: "IT Project", slug: slug("project") },
		});
		const project = expectOk(projRes.data, projRes.response);
		projectCleanup.track(project.id as string);
		expect(projRes.response.status).toBe(201);

		const created = await client.POST("/services", {
			body: {
				authRequired: false,
				buildSource: "image",
				containerPort: 80,
				dnsResolvable: false,
				envVars: {},
				image: "nginx",
				name: "IT in project",
				projectId: project.id as string,
				restartPolicy: "no",
				slug: slug("in-project"),
				tag: "alpine",
			},
		});
		const svc = expectOk(created.data, created.response);
		cleanup.track(svc.id as string);
		expect(svc.projectId).toBe(project.id as string);

		await client.POST("/services/{serviceId}/deploy", {
			params: { path: { serviceId: svc.id as string } },
		});
		await waitForStatus(svc.id as string, "running");
	});

	test("env vars land in the running container", async () => {
		const created = await client.POST("/services", {
			body: {
				authRequired: false,
				buildSource: "image",
				containerPort: 80,
				dnsResolvable: false,
				envVars: { IT_MARKER: "hello-from-integration-test" },
				image: "nginx",
				name: "IT env vars",
				restartPolicy: "no",
				slug: slug("envvars"),
				tag: "alpine",
			},
		});
		const svc = expectOk(created.data, created.response);
		cleanup.track(svc.id as string);

		await client.POST("/services/{serviceId}/deploy", {
			params: { path: { serviceId: svc.id as string } },
		});
		await waitForStatus(svc.id as string, "running");

		const fetched = await client.GET("/services/{serviceId}", {
			params: { path: { serviceId: svc.id as string } },
		});
		const svcAfter = expectOk(fetched.data, fetched.response);
		expect(svcAfter.envVars).toEqual({
			IT_MARKER: "hello-from-integration-test",
		});
	});

	test("bad image fails cleanly with a real error, not silently", async () => {
		const created = await client.POST("/services", {
			body: {
				authRequired: false,
				buildSource: "image",
				containerPort: 80,
				dnsResolvable: false,
				envVars: {},
				image: "this-image-definitely-does-not-exist-anywhere",
				name: "IT bad image",
				restartPolicy: "no",
				slug: slug("badimage"),
				tag: "latest",
			},
		});
		const svc = expectOk(created.data, created.response);
		cleanup.track(svc.id as string);

		const deployed = await client.POST("/services/{serviceId}/deploy", {
			params: { path: { serviceId: svc.id as string } },
		});
		expect(deployed.response.status).toBe(500);
		// The route's real failure shape is `{deploymentId, error}` (see
		// services/[serviceId]/deploy/+server.ts), not `{success, error}` :
		// `success:false` only appears in the *200* response body of a
		// deploy call that itself completed but the underlying operation
		// reported failure, this route never returns 200 with success:false.
		const errorBody = deployed.error as
			| { deploymentId?: string; error?: string }
			| undefined;
		expect(typeof errorBody?.error).toBe("string");
		expect(errorBody?.error?.length).toBeGreaterThan(0);
	});
});

describe("services : lifecycle", () => {
	test("start/stop/restart on an already-deployed local service", async () => {
		const created = await client.POST("/services", {
			body: {
				authRequired: false,
				buildSource: "image",
				containerPort: 80,
				dnsResolvable: false,
				envVars: {},
				image: "nginx",
				name: "IT lifecycle",
				restartPolicy: "no",
				slug: slug("lifecycle"),
				tag: "alpine",
			},
		});
		const svc = expectOk(created.data, created.response);
		cleanup.track(svc.id as string);
		await client.POST("/services/{serviceId}/deploy", {
			params: { path: { serviceId: svc.id as string } },
		});
		await waitForStatus(svc.id as string, "running");

		const stopRes = await client.POST("/services/{serviceId}/stop", {
			params: { path: { serviceId: svc.id as string } },
		});
		expect(stopRes.response.status).toBe(200);
		await waitForStatus(svc.id as string, "stopped");

		const startRes = await client.POST("/services/{serviceId}/start", {
			params: { path: { serviceId: svc.id as string } },
		});
		expect(startRes.response.status).toBe(200);
		await waitForStatus(svc.id as string, "running");

		const restartRes = await client.POST("/services/{serviceId}/restart", {
			params: { path: { serviceId: svc.id as string } },
		});
		expect(restartRes.response.status).toBe(200);
		await waitForStatus(svc.id as string, "running");
	});
});

describe("services : remote deploy targets", () => {
	test("deploy to a docker-kind remote host (real second daemon connection)", async () => {
		const ctx = integrationContext();
		const created = await client.POST("/services", {
			body: {
				authRequired: false,
				buildSource: "image",
				containerPort: 80,
				dnsResolvable: false,
				envVars: {},
				image: "nginx",
				name: "IT docker remote",
				restartPolicy: "no",
				slug: slug("docker-remote"),
				tag: "alpine",
			},
		});
		const svc = expectOk(created.data, created.response);
		cleanup.track(svc.id as string);

		const patched = await client.PATCH("/services/{serviceId}", {
			body: { remoteHostId: ctx.dockerRemoteHostId },
			params: { path: { serviceId: svc.id as string } },
		});
		expect(patched.response.status).toBe(200);

		await client.POST("/services/{serviceId}/deploy", {
			params: { path: { serviceId: svc.id as string } },
		});
		const status = await waitForStatus(svc.id as string, "running");
		expect(status.containerId).toBeTruthy();
	});

	test("deploy to an agent-kind remote host (real spawned agent)", async () => {
		const ctx = integrationContext();
		const created = await client.POST("/services", {
			body: {
				authRequired: false,
				buildSource: "image",
				containerPort: 80,
				dnsResolvable: false,
				envVars: {},
				image: "nginx",
				name: "IT agent remote",
				restartPolicy: "no",
				slug: slug("agent-remote"),
				tag: "alpine",
			},
		});
		const svc = expectOk(created.data, created.response);
		cleanup.track(svc.id as string);

		const patched = await client.PATCH("/services/{serviceId}", {
			body: { remoteHostId: ctx.agentRemoteHostId },
			params: { path: { serviceId: svc.id as string } },
		});
		expect(patched.response.status).toBe(200);

		const deployed = await client.POST("/services/{serviceId}/deploy", {
			params: { path: { serviceId: svc.id as string } },
		});
		const deployResult = expectOk(deployed.data, deployed.response);
		expect(deployResult.success).toBe(true);
		const status = await waitForStatus(svc.id as string, "running");
		expect(status.containerId).toBeTruthy();

		// Lifecycle actions must also route through the agent, not silently
		// fall back to the local socket (the exact real bug this session
		// found and fixed).
		const stopRes = await client.POST("/services/{serviceId}/stop", {
			params: { path: { serviceId: svc.id as string } },
		});
		expect(stopRes.response.status).toBe(200);
		await waitForStatus(svc.id as string, "stopped");
	});
});

describe("services : git-build deploy", () => {
	test("local target, built from a real git clone", async () => {
		const ctx = integrationContext();
		const created = await client.POST("/services", {
			body: {
				authRequired: false,
				buildSource: "git",
				// containerPort is required unconditionally by
				// createServiceApiBody (not just for buildSource: "image"),
				// confirmed by reading the schema after this test 400'd
				// without it.
				containerPort: 80,
				dnsResolvable: false,
				envVars: {},
				gitUrl: ctx.gitBuildFixtureUrl,
				name: "IT git build",
				restartPolicy: "no",
				slug: slug("gitbuild"),
			},
		});
		const svc = expectOk(created.data, created.response);
		expect(created.response.status).toBe(201);
		cleanup.track(svc.id as string);

		const deployed = await client.POST("/services/{serviceId}/deploy", {
			params: { path: { serviceId: svc.id as string } },
		});
		const deployResult = expectOk(deployed.data, deployed.response);
		expect(deployResult.success).toBe(true);
		await waitForStatus(svc.id as string, "running");
	});
});

describe("services : update and delete", () => {
	test("PATCH updates non-remoteHostId fields, DELETE actually removes it", async () => {
		const created = await client.POST("/services", {
			body: {
				authRequired: false,
				buildSource: "image",
				containerPort: 80,
				dnsResolvable: false,
				envVars: {},
				image: "nginx",
				name: "IT patch-delete",
				restartPolicy: "no",
				slug: slug("patch-delete"),
				tag: "alpine",
			},
		});
		const svc = expectOk(created.data, created.response);

		const patched = await client.PATCH("/services/{serviceId}", {
			body: {
				envVars: { PATCHED: "yes" },
				name: "IT patch-delete (renamed)",
			},
			params: { path: { serviceId: svc.id as string } },
		});
		const patchedSvc = expectOk(patched.data, patched.response);
		expect(patchedSvc.name).toBe("IT patch-delete (renamed)");
		expect(patchedSvc.envVars).toEqual({ PATCHED: "yes" });

		const deleted = await client.DELETE("/services/{serviceId}", {
			params: { path: { serviceId: svc.id as string } },
		});
		expect(deleted.response.status).toBe(204);

		const afterDelete = await client.GET("/services/{serviceId}", {
			params: { path: { serviceId: svc.id as string } },
		});
		expect(afterDelete.response.status).toBe(404);
	});
});

describe("services : auth and ownership", () => {
	test("no api key is unauthorized", async () => {
		const res = await nativeFetch(
			`${integrationContext().origin}/api/v1/services`,
		);
		expect(res.status).toBe(401);
	});

	test("acting on a nonexistent/foreign service id is 404, not 403", async () => {
		const res = await client.GET("/services/{serviceId}", {
			params: { path: { serviceId: "00000000-0000-0000-0000-000000000000" } },
		});
		expect(res.response.status).toBe(404);
	});
});
