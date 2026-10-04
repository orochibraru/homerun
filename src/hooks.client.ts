import type { HandleClientError } from "@sveltejs/kit/hooks";
import { dev } from "$app/env";

function makeid(length: number) {
	let result = "";
	const characters =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const charactersLength = characters.length;
	for (let i = 0; i < length; i += 1) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
}

/**
 * Logs an uncaught client-side error to the console and gives it a random
 * 24-character id; errors thrown with `error()` and SvelteKit's own keep their
 * defaults. The real message is only shown in dev; production shows a
 * generic one.
 */
export const handleError: HandleClientError = ({ error, event, kind }) => {
	if (kind !== "unknown") {
		return;
	}
	const errorId = makeid(24);

	// Client-side: Logger pulls in $lib/config, which is server-only (node:fs/node:os/Bun).
	// oxlint-disable-next-line no-console -- no logger available in the browser
	console.error("An error occurred on the client side:", error, event);

	if (dev) {
		if (error instanceof Error) {
			return {
				errorId,
				message: error.message,
			};
		}

		return {
			errorId,
			message: String(error),
		};
	}

	return {
		errorId,
		message: "Whoops!",
	};
};
