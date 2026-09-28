import { spyOn } from "bun:test";

export interface StubbedCall {
	body: string | null;
	headers: Headers;
	method: string;
	url: string;
}

let spy: { mockRestore: () => void } | null = null;

/**
 * Replaces `fetch` with `handler`, recording every call. The handler returns
 * a JSON body for a 200, or `{ status, body }` (or `{ status, raw }` for a
 * non-JSON answer) for anything else.
 */
export function stubFetch(
	handler: (request: StubbedCall) => unknown,
): StubbedCall[] {
	const calls: StubbedCall[] = [];
	spy?.mockRestore();
	spy = spyOn(globalThis, "fetch").mockImplementation((async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const request = new Request(input, init);
		const call: StubbedCall = {
			body:
				init?.body == null
					? null
					: typeof init.body === "string"
						? init.body
						: await request.text(),
			headers: request.headers,
			method: request.method,
			url: request.url,
		};
		calls.push(call);
		const answer = await handler(call);
		const shaped =
			answer &&
			typeof answer === "object" &&
			"status" in answer &&
			typeof answer.status === "number"
				? (answer as {
						body?: unknown;
						headers?: Record<string, string>;
						raw?: string;
						status: number;
					})
				: { body: answer, status: 200 };
		return new Response(
			shaped.raw ??
				(shaped.body === undefined ? "" : JSON.stringify(shaped.body)),
			{
				headers: shaped.headers,
				status: shaped.status,
			},
		);
	}) as typeof fetch);
	return calls;
}

stubFetch.restore = () => {
	spy?.mockRestore();
	spy = null;
};
