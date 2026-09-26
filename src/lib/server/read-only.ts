import { stringify } from "devalue";
import {
	APP_ONLY_HOME,
	APP_ONLY_MESSAGE,
	appOnlyMayRequest,
	READ_ONLY_MESSAGE,
	readOnlyMayRequest,
} from "$lib/permissions";

type RefusedRequest = Pick<Request, "headers" | "method">;

/**
 * A 403 shaped for whoever sent the request: an `ActionResult` failure for a
 * `use:enhance` form (so the promise toast shows the reason), a
 * remote-function error for a command or query, JSON for the REST API, and
 * plain text otherwise.
 */
function forbidden(
	request: RefusedRequest,
	pathname: string,
	message: string,
): Response {
	const jsonHeaders = { "content-type": "application/json" };
	if (request.headers.get("x-sveltekit-action") === "true") {
		return new Response(
			JSON.stringify({
				data: stringify({ error: message }),
				status: 403,
				type: "failure",
			}),
			{ headers: jsonHeaders, status: 200 },
		);
	}
	if (pathname.startsWith("/_app/remote/")) {
		return new Response(
			JSON.stringify({
				error: { message },
				status: 403,
				type: "error",
			}),
			{ headers: jsonHeaders, status: 403 },
		);
	}
	if (pathname.startsWith("/api/")) {
		return new Response(JSON.stringify({ error: message }), {
			headers: jsonHeaders,
			status: 403,
		});
	}
	return new Response(message, { status: 403 });
}

/**
 * The 403 a read-only caller gets for a write, shaped for whoever sent it.
 *
 * @returns Null when the request is allowed.
 */
export function readOnlyRejection(
	request: RefusedRequest,
	pathname: string,
): Response | null {
	if (readOnlyMayRequest(request.method, pathname)) {
		return null;
	}
	return forbidden(request, pathname, READ_ONLY_MESSAGE);
}

/**
 * What an app-access-only user gets for anything outside `appOnlyMayRequest`:
 * a page navigation is sent to their apps page (a `__data.json` request gets
 * SvelteKit's own JSON redirect so client-side navigation follows it), and
 * every other request a 403 shaped like `readOnlyRejection`'s.
 *
 * @returns Null when the request is allowed.
 */
export function appOnlyRejection(
	request: RefusedRequest,
	pathname: string,
	routeId: string | null,
	isDataRequest: boolean,
): Response | null {
	if (appOnlyMayRequest(pathname, routeId)) {
		return null;
	}
	const isPageRead =
		(request.method === "GET" || request.method === "HEAD") &&
		!pathname.startsWith("/api/") &&
		!pathname.startsWith("/_app/");
	if (isPageRead && isDataRequest) {
		return new Response(
			JSON.stringify({ location: APP_ONLY_HOME, type: "redirect" }),
			{ headers: { "content-type": "application/json" } },
		);
	}
	if (isPageRead) {
		return new Response(null, {
			headers: { location: APP_ONLY_HOME },
			status: 303,
		});
	}
	return forbidden(request, pathname, APP_ONLY_MESSAGE);
}
