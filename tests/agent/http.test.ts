import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { DockerService } from "../../agent/docker";
import { AgentHttpServer } from "../../agent/http";
import { SystemStatsService } from "../../agent/stats";
import { AGENT_VERSION } from "../../agent/version";

/**
 * `AgentHttpServer.routes` is auth/error-wrapping logic over `DockerService`/
 * `SystemStatsService`'s instance methods : replaced here with `spyOn`
 * (restored via `mock.restore()` after every test) rather than a wholesale
 * `mock.module("../../agent/docker", ...)`. The latter mutates the shared
 * module registry process-wide (see tests/README.md) and would collide with
 * docker.test.ts, which needs the *real* agent/docker.ts (backed by a mocked
 * "dockerode") to still work regardless of file run order. `spyOn` only
 * patches the specific methods used below, and cleanly reverts them.
 *
 * `routes` is Bun's own route table (`Bun.serve({ routes })`), Bun does the
 * `:id`-segment/method matching internally when a real server is listening,
 * there's no bare matcher function exposed to call directly the way the old
 * hand-rolled `handle` was. A real `Bun.serve()` + real `fetch()` round trip
 * was tried here first and doesn't work in this repo : `tests/app/svelte-loader.ts`'s
 * `GlobalRegistrator.register()` (a `beforeEach`, see tests/README.md's
 * "process-global test env" note) swaps in happy-dom's `Response`/`Request`
 * globals for the whole process before every test body runs, and `agent/http.ts`'s
 * own `json()` helper does `new Response(...)` against whatever `Response`
 * is ambient *at request-handling time*, so every route response ends up a
 * happy-dom `Response` instance ; Bun's real socket layer then rejects it
 * ("Expected a Response object, but received..."), confirmed live. (`Server`'s
 * own `.fetch(request)` convenience method looked like a no-socket way around
 * that, but verified live it only invokes the top-level `fetch` fallback, it
 * doesn't dispatch through `routes` at all, so it's not usable either.) So
 * `handle` below is a small path/method matcher over `agentServer.routes`
 * itself, mirroring what Bun's real router does for `:id`-style params,
 * calling the exact handler functions Bun would (auth/error-wrapping and all),
 * just without a real socket in the loop.
 */
function freshDefaults() {
	return {
		deploy: spyOn(DockerService, "deploy").mockImplementation(async () => ({
			containerId: "container-1",
			log: ["ok"],
		})),
		getSystemStats: spyOn(
			SystemStatsService,
			"getSystemStats",
		).mockImplementation(async () => ({
			cpuPercent: 1,
			diskPercent: null,
			diskTotalMb: null,
			diskUsedMb: null,
			gpu: null,
			memPercent: 2,
			memTotalMb: 100,
			memUsedMb: 2,
		})),
		inspectStatus: spyOn(DockerService, "inspectStatus").mockImplementation(
			async (id: string) => ({ id, state: "running", status: "running" }),
		),
		listManagedContainers: spyOn(
			DockerService,
			"listManagedContainers",
		).mockImplementation(async () => [{ Id: "container-1" }] as never),
		removeContainer: spyOn(DockerService, "removeContainer").mockImplementation(
			async () => undefined,
		),
		restartContainer: spyOn(
			DockerService,
			"restartContainer",
		).mockImplementation(async () => undefined),
		startContainer: spyOn(DockerService, "startContainer").mockImplementation(
			async () => undefined,
		),
		stopContainer: spyOn(DockerService, "stopContainer").mockImplementation(
			async () => undefined,
		),
		streamLogs: spyOn(DockerService, "streamLogs").mockImplementation(
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
const agentServer = new AgentHttpServer(TOKEN);

function req(path: string, init?: RequestInit & { authed?: boolean }): Request {
	const { authed, ...rest } = init ?? {};
	const headers = new Headers(rest.headers);
	if (authed) {
		headers.set("authorization", `Bearer ${TOKEN}`);
	}
	return new Request(`http://agent.local${path}`, { ...rest, headers });
}

type RouteHandler = (
	req: Request & { params: Record<string, string> },
) => Response | Promise<Response>;

/** `pattern` is one of `agentServer.routes`'s keys, e.g. `"/v1/containers/:id"`. Returns the extracted `:param`s, or `null` if `pathname` doesn't match its shape. */
function matchPattern(
	pattern: string,
	pathname: string,
): Record<string, string> | null {
	const patternParts = pattern.split("/");
	const pathParts = pathname.split("/");
	if (patternParts.length !== pathParts.length) {
		return null;
	}
	const params: Record<string, string> = {};
	for (const [i, part] of patternParts.entries()) {
		const pathPart = pathParts[i] as string;
		if (part.startsWith(":")) {
			params[part.slice(1)] = pathPart;
		} else if (part !== pathPart) {
			return null;
		}
	}
	return params;
}

/** Routes `request` through `agentServer.routes` the way Bun's real router would, see the file-level comment above for why this isn't a real `Bun.serve()` round trip. */
async function handle(request: Request): Promise<Response> {
	const { pathname } = new URL(request.url);
	for (const [pattern, methods] of Object.entries(agentServer.routes)) {
		const params = matchPattern(pattern, pathname);
		if (!params) {
			continue;
		}
		const fn = (methods as Record<string, RouteHandler>)[request.method];
		if (!fn) {
			continue;
		}
		return fn(Object.assign(request, { params }));
	}
	return agentServer.notFound();
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
