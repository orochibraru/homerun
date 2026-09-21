import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { WorkerRequestError as WorkerRequestErrorType } from "../../../src/lib/server/worker-client";

const { WorkerClient, WorkerRequestError, isNotFound } = await import(
	"../../../src/lib/server/worker-client"
);

interface Recorded {
	body: string | null;
	headers: Headers;
	method: string;
	url: string;
}

const realFetch = globalThis.fetch;
let recorded: Recorded[] = [];

/** Stands a stub in for fetch, answering every call with `answer`. */
function stubFetch(
	answer: (request: Recorded) => Response | Promise<Response>,
) {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const entry: Recorded = {
			body: typeof init?.body === "string" ? init.body : null,
			headers: new Headers(init?.headers),
			method: init?.method ?? "GET",
			url: String(input),
		};
		recorded.push(entry);
		return answer(entry);
	}) as typeof fetch;
}

beforeEach(() => {
	recorded = [];
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("request shaping", () => {
	test("builds an absolute worker URL and carries the bearer token", async () => {
		stubFetch(() => Response.json({ ok: true }));
		await WorkerClient.get("/v1/containers/abc/status");

		const [call] = recorded;
		expect(call?.url).toBe(`${WorkerClient.baseUrl}/v1/containers/abc/status`);
		expect(call?.headers.get("authorization")).toStartWith("Bearer ");
	});

	test("drops undefined query values and keeps the rest", async () => {
		stubFetch(() => Response.json([]));
		await WorkerClient.get("/v1/containers", { all: "1", label: undefined });

		expect(recorded[0]?.url).toBe(
			`${WorkerClient.baseUrl}/v1/containers?all=1`,
		);
	});

	test("sends a JSON body with its content type, and none when there isn't one", async () => {
		stubFetch(() => Response.json({ id: "c1" }));
		await WorkerClient.post("/v1/containers", { name: "x" });
		expect(recorded[0]?.body).toBe(`{"name":"x"}`);
		expect(recorded[0]?.headers.get("content-type")).toBe("application/json");

		recorded = [];
		await WorkerClient.post("/v1/containers/c1/start");
		expect(recorded[0]?.body).toBeNull();
		expect(recorded[0]?.headers.get("content-type")).toBeNull();
	});

	test("reads an empty body as null rather than failing to parse it", async () => {
		stubFetch(() => new Response("", { status: 200 }));
		expect(await WorkerClient.delete("/v1/containers/c1")).toBeNull();
	});
});

describe("failures", () => {
	test("surfaces the worker's own error message and status", async () => {
		stubFetch(() =>
			Response.json({ error: "No such container." }, { status: 404 }),
		);

		const failure = await WorkerClient.get("/v1/containers/gone/inspect").catch(
			(error: unknown) => error,
		);
		expect(failure).toBeInstanceOf(WorkerRequestError);
		expect((failure as WorkerRequestErrorType).message).toBe(
			"No such container.",
		);
		expect((failure as WorkerRequestErrorType).status).toBe(404);
		expect(isNotFound(failure)).toBe(true);
	});

	test("isNotFound only matches a 404", async () => {
		stubFetch(() => Response.json({ error: "boom" }, { status: 500 }));
		const failure = await WorkerClient.get("/v1/info").catch(
			(error: unknown) => error,
		);
		expect(isNotFound(failure)).toBe(false);
		expect(isNotFound(new Error("boom"))).toBe(false);
	});

	test("falls back to the status when the body isn't the usual JSON shape", async () => {
		stubFetch(() => new Response("", { status: 502 }));
		const failure = await WorkerClient.get("/v1/info").catch(
			(error: unknown) => error,
		);
		expect((failure as Error).message).toBe("The worker answered 502.");
	});

	test("uses a non-JSON body verbatim when there is one", async () => {
		stubFetch(() => new Response("upstream exploded", { status: 502 }));
		const failure = await WorkerClient.get("/v1/info").catch(
			(error: unknown) => error,
		);
		expect((failure as Error).message).toBe("upstream exploded");
	});

	test("says the worker is unreachable rather than leaking 'fetch failed'", async () => {
		stubFetch(() => {
			throw new Error("connection refused");
		});
		const failure = await WorkerClient.get("/v1/info").catch(
			(error: unknown) => error,
		);
		expect((failure as Error).message).toContain("Couldn't reach");
		expect((failure as Error).message).toContain(WorkerClient.baseUrl);
	});
});

describe("streams and raw bodies", () => {
	test("returns the response body as a stream", async () => {
		stubFetch(() => new Response("hello\nworld\n", { status: 200 }));
		const stream = await WorkerClient.stream("/v1/containers/c1/logs", {
			query: { follow: "0", tail: "5" },
		});
		expect(await new Response(stream).text()).toBe("hello\nworld\n");
		expect(recorded[0]?.url).toEndWith(
			"/v1/containers/c1/logs?follow=0&tail=5",
		);
	});

	test("a body-less stream answer still yields an empty stream", async () => {
		stubFetch(() => new Response(null, { status: 200 }));
		const stream = await WorkerClient.stream("/v1/containers/c1/logs");
		expect(await new Response(stream).text()).toBe("");
	});

	test("a failed stream reports the worker's error rather than handing back a body", async () => {
		stubFetch(() =>
			Response.json({ error: "No such container." }, { status: 404 }),
		);
		const failure = await WorkerClient.stream("/v1/containers/x/logs").catch(
			(error: unknown) => error,
		);
		expect(isNotFound(failure)).toBe(true);
	});

	test("postRaw sends the bytes as-is, with no JSON content type", async () => {
		stubFetch(() => Response.json({ ok: true }));
		await WorkerClient.postRaw("/v1/terminal/s1/input", "ls -la\n");
		expect(recorded[0]?.body).toBe("ls -la\n");
		expect(recorded[0]?.headers.get("content-type")).toBeNull();
	});

	test("putRaw uploads a tar and resolves with nothing", async () => {
		stubFetch(() => Response.json({ ok: true }));
		await WorkerClient.putRaw("/v1/containers/c1/archive", "tar-bytes", {
			path: "/data",
		});
		expect(recorded[0]?.method).toBe("PUT");
		expect(recorded[0]?.url).toEndWith("?path=%2Fdata");
		expect(recorded[0]?.headers.get("content-type")).toBe("application/x-tar");
	});
});
