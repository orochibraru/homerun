import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import * as dockerModule from "../../agent/docker";
import { createHandler } from "../../agent/http";
import * as statsModule from "../../agent/stats";
import { AGENT_VERSION } from "../../agent/version";

/**
 * `createHandler` is pure routing/auth logic over the functions imported
 * from "./docker" and "./stats" : replaced here with `spyOn` (restored via
 * `mock.restore()` after every test) rather than a wholesale
 * `mock.module("../../agent/docker", ...)`. The latter mutates the shared
 * module registry process-wide (see tests/README.md) and would collide with
 * docker.test.ts, which needs the *real* agent/docker.ts (backed by a mocked
 * "dockerode") to still work regardless of file run order. `spyOn` only
 * patches the specific functions used below, and cleanly reverts them.
 */
function freshDefaults() {
	return {
		deploy: spyOn(dockerModule, "deploy").mockImplementation(async () => ({
			containerId: "container-1",
			log: ["ok"],
		})),
		getSystemStats: spyOn(statsModule, "getSystemStats").mockImplementation(
			async () => ({
				cpuPercent: 1,
				diskPercent: null,
				diskTotalMb: null,
				diskUsedMb: null,
				gpu: null,
				memPercent: 2,
				memTotalMb: 100,
				memUsedMb: 2,
			}),
		),
		inspectStatus: spyOn(dockerModule, "inspectStatus").mockImplementation(
			async (id: string) => ({ id, state: "running", status: "running" }),
		),
		listManagedContainers: spyOn(
			dockerModule,
			"listManagedContainers",
		).mockImplementation(async () => [{ Id: "container-1" }] as never),
		removeContainer: spyOn(dockerModule, "removeContainer").mockImplementation(
			async () => undefined,
		),
		restartContainer: spyOn(
			dockerModule,
			"restartContainer",
		).mockImplementation(async () => undefined),
		startContainer: spyOn(dockerModule, "startContainer").mockImplementation(
			async () => undefined,
		),
		stopContainer: spyOn(dockerModule, "stopContainer").mockImplementation(
			async () => undefined,
		),
		streamLogs: spyOn(dockerModule, "streamLogs").mockImplementation(
			async () =>
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("log bytes"));
						controller.close();
					},
				}),
		),
	};
}

let mocks: ReturnType<typeof freshDefaults>;

const TOKEN = "test-token-123";
const handle = createHandler(TOKEN);

function req(path: string, init?: RequestInit & { authed?: boolean }): Request {
	const { authed, ...rest } = init ?? {};
	const headers = new Headers(rest.headers);
	if (authed) {
		headers.set("authorization", `Bearer ${TOKEN}`);
	}
	return new Request(`http://agent.local${path}`, { ...rest, headers });
}

beforeEach(() => {
	mocks = freshDefaults();
});

afterEach(() => {
	mock.restore();
});

describe("public routes", () => {
	test("GET /v1/health needs no auth", async () => {
		const res = await handle(req("/v1/health"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok", version: AGENT_VERSION });
	});

	test("GET /v1/openapi.json needs no auth", async () => {
		const res = await handle(req("/v1/openapi.json"));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { openapi: string };
		expect(body.openapi).toBe("3.1.0");
	});
});

describe("auth", () => {
	test("a protected route with no Authorization header is rejected", async () => {
		const res = await handle(req("/v1/stats"));
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "Unauthorized" });
	});

	test("a protected route with the wrong token is rejected", async () => {
		const res = await handle(
			req("/v1/stats", {
				headers: { authorization: "Bearer wrong-token" },
			}),
		);
		expect(res.status).toBe(401);
	});

	test("a non-Bearer Authorization header is rejected", async () => {
		const res = await handle(
			req("/v1/stats", { headers: { authorization: TOKEN } }),
		);
		expect(res.status).toBe(401);
	});

	test("the correct Bearer token is accepted", async () => {
		const res = await handle(req("/v1/stats", { authed: true }));
		expect(res.status).toBe(200);
	});
});

describe("routes", () => {
	test("GET /v1/stats returns getSystemStats()'s result", async () => {
		const res = await handle(req("/v1/stats", { authed: true }));
		expect(await res.json()).toEqual(await mocks.getSystemStats());
	});

	test("GET /v1/containers lists managed containers", async () => {
		const res = await handle(req("/v1/containers", { authed: true }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([{ Id: "container-1" }]);
	});

	test("POST /v1/deploy rejects an invalid body with 400 and no deploy() call", async () => {
		const res = await handle(
			req("/v1/deploy", {
				authed: true,
				body: JSON.stringify({ image: "" }),
				method: "POST",
			}),
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; issues: unknown };
		expect(body.error).toBe("Invalid request body");
		expect(Array.isArray(body.issues)).toBe(true);
		expect(mocks.deploy).not.toHaveBeenCalled();
	});

	test("POST /v1/deploy rejects unparseable JSON with 400", async () => {
		const res = await handle(
			req("/v1/deploy", {
				authed: true,
				body: "not json",
				method: "POST",
			}),
		);
		expect(res.status).toBe(400);
	});

	test("POST /v1/deploy calls deploy() with the parsed body and returns its result", async () => {
		const input = {
			containerPort: 80,
			cpuLimit: null,
			envVars: [],
			image: "nginx",
			memoryLimitMb: null,
			networkMode: "bridge",
			portProtocol: "tcp",
			restartPolicy: "always",
			serviceId: "svc-1",
			slug: "svc",
			tag: "latest",
		};
		const res = await handle(
			req("/v1/deploy", {
				authed: true,
				body: JSON.stringify(input),
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			containerId: "container-1",
			log: ["ok"],
		});
		expect(mocks.deploy).toHaveBeenCalledTimes(1);
		expect(mocks.deploy.mock.calls[0][0]).toMatchObject({
			image: "nginx",
			serviceId: "svc-1",
		});
	});

	test("GET /v1/containers/:id inspects that container, decoding the id", async () => {
		const res = await handle(req("/v1/containers/abc%2Fdef", { authed: true }));
		expect(res.status).toBe(200);
		expect(mocks.inspectStatus).toHaveBeenCalledWith("abc/def");
	});

	test("DELETE /v1/containers/:id removes it", async () => {
		const res = await handle(
			req("/v1/containers/abc", { authed: true, method: "DELETE" }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(mocks.removeContainer).toHaveBeenCalledWith("abc");
	});

	test.each(["start", "stop", "restart"] as const)(
		"POST /v1/containers/:id/%s calls the matching action",
		async (action) => {
			const res = await handle(
				req(`/v1/containers/abc/${action}`, { authed: true, method: "POST" }),
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ ok: true });
		},
	);

	test("GET /v1/containers/:id/logs streams bytes with an octet-stream content type", async () => {
		const res = await handle(
			req("/v1/containers/abc/logs?follow=true", { authed: true }),
		);
		expect(res.headers.get("content-type")).toBe("application/octet-stream");
		expect(await res.text()).toBe("log bytes");
		expect(mocks.streamLogs).toHaveBeenCalledWith("abc", true);
	});

	test("logs defaults to follow=false when the query param is absent", async () => {
		await handle(req("/v1/containers/abc/logs", { authed: true }));
		expect(mocks.streamLogs).toHaveBeenCalledWith("abc", false);
	});

	test("an unknown path 404s", async () => {
		const res = await handle(req("/v1/nope", { authed: true }));
		expect(res.status).toBe(404);
	});

	test("a thrown error inside a route surfaces as a 500 with its message", async () => {
		mocks.inspectStatus.mockImplementationOnce(async () => {
			throw new Error("inspect boom");
		});
		const res = await handle(req("/v1/containers/abc", { authed: true }));
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: "inspect boom" });
	});
});
