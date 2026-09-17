import { error } from "@sveltejs/kit";
import { getRequestEvent } from "$app/server";
import { READ_ONLY_MESSAGE } from "$lib/permissions";
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

/**
 * The signed-in user for a remote command that changes shared state, only if
 * they may write. The request hook already refuses read-only callers before a
 * command runs; this is the same check at the call site, so a command that
 * lands on the hook's self-service allowlist by name still can't write.
 *
 * @throws A 401 error when nobody is signed in, or 403 when the user holds the
 * read-only role or authenticated with a read-scoped API key.
 */
export function requireWriter(): AuthType["user"] {
	const { locals } = getRequestEvent();
	const user = requireUser();
	if (locals.readOnly) {
		error(403, READ_ONLY_MESSAGE);
	}
	return user;
}
