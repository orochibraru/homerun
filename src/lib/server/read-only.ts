import { stringify } from "devalue";
import { READ_ONLY_MESSAGE, readOnlyMayRequest } from "$lib/permissions";

/**
 * The 403 a read-only caller gets for a write, shaped for whoever sent it: an
 * `ActionResult` failure for a `use:enhance` form (so the promise toast shows
 * the reason), a remote-function error for a command, JSON for the REST API,
 * and plain text otherwise.
 *
 * @returns Null when the request is allowed.
 */
export function readOnlyRejection(
	request: Pick<Request, "headers" | "method">,
	pathname: string,
): Response | null {
	if (readOnlyMayRequest(request.method, pathname)) {
		return null;
	}
	const jsonHeaders = { "content-type": "application/json" };
	if (request.headers.get("x-sveltekit-action") === "true") {
		return new Response(
			JSON.stringify({
				data: stringify({ error: READ_ONLY_MESSAGE }),
				status: 403,
				type: "failure",
			}),
			{ headers: jsonHeaders, status: 200 },
		);
	}
	if (pathname.startsWith("/_app/remote/")) {
		return new Response(
			JSON.stringify({
				error: { message: READ_ONLY_MESSAGE },
				status: 403,
				type: "error",
			}),
			{ headers: jsonHeaders, status: 403 },
		);
	}
	if (pathname.startsWith("/api/")) {
		return new Response(JSON.stringify({ error: READ_ONLY_MESSAGE }), {
			headers: jsonHeaders,
			status: 403,
		});
	}
	return new Response(READ_ONLY_MESSAGE, { status: 403 });
}
