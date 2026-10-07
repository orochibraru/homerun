import { error } from "@sveltejs/kit";
import {
	APP_ONLY_MESSAGE,
	can,
	type PermissionArea,
	type PermissionLevel,
	permissionDeniedMessage,
} from "#lib/permissions.js";
import type { AuthType } from "#lib/services/auth.js";
import { getRequestEvent } from "$app/server";

/**
 * The signed-in user for the current remote function call.
 *
 * @throws A 401 error when nobody is signed in, or 403 for an
 * app-access-only user, who can't use the dashboard's remote functions.
 */
export function requireUser(): AuthType["user"] {
	const { locals } = getRequestEvent();
	if (!locals.user) {
		error(401, "Unauthorized");
	}
	if (locals.appOnly) {
		error(403, APP_ONLY_MESSAGE);
	}
	return locals.user;
}

/**
 * The signed-in user for the current remote function call, only if their
 * permissions (narrowed by the API key they used, if any) grant `level` on
 * `area`.
 *
 * @throws A 401 error when nobody is signed in, or 403 when the permission
 * is missing.
 */
export function requirePermission(
	area: PermissionArea,
	level: PermissionLevel,
): AuthType["user"] {
	const { locals } = getRequestEvent();
	const user = requireUser();
	if (!can(locals.permissions, area, level)) {
		error(403, permissionDeniedMessage(area, level));
	}
	return user;
}
