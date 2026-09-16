import { error } from "@sveltejs/kit";
import { getRequestEvent } from "$app/server";
import type { AuthType } from "$lib/services/auth";

/**
 * The signed-in user for the current remote function call.
 *
 * @throws A 401 error when nobody is signed in.
 */
export function requireUser(): AuthType["user"] {
	const { locals } = getRequestEvent();
	if (!locals.user) {
		error(401, "Unauthorized");
	}
	return locals.user;
}

/**
 * The signed-in user for the current remote function call, only if they are an
 * admin.
 *
 * @throws A 401 error when nobody is signed in, or 403 when the user isn't an
 * admin.
 */
export function requireAdmin(): AuthType["user"] {
	const { locals } = getRequestEvent();
	const user = requireUser();
	if (!locals.isAdmin) {
		error(403, "Forbidden");
	}
	return user;
}
