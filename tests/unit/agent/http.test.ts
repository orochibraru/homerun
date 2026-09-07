import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { DockerService } from "../../../packages/agent/docker";
import { AgentHttpServer } from "../../../packages/agent/http";
import { SystemStatsService } from "../../../packages/agent/stats";
import { AGENT_VERSION } from "../../../packages/agent/version";

/**
 * `AgentHttpServer.routes` is auth/error-wrapping logic over `DockerService`/
 * `SystemStatsService`'s instance methods : replaced here with `spyOn`
 * (restored via `mock.restore()` after every test) rather than a wholesale
 * `mock.module("../../packages/agent/docker", ...)`. The latter mutates the shared
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
		buildFromGit: spyOn(DockerService, "buildFromGit").mockImplementation(
			async () => ({ success: true }),
		),
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

	test("an unknown path 404s", async () => {
		const res = await handle(req("/v1/nope", { authed: true }));
		expect(res.status).toBe(404);
	});

	test("a thrown error inside a route surfaces as a 500 with its message", async () => {
		mocks.getSystemStats.mockImplementationOnce(async () => {
			throw new Error("stats boom");
		});
		const res = await handle(req("/v1/stats", { authed: true }));
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: "stats boom" });
	});
});
