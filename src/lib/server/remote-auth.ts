import { error } from "@sveltejs/kit";
import { getRequestEvent } from "$app/server";
import type { AuthType } from "$lib/services/auth";

export function requireUser(): AuthType["user"] {
	const { locals } = getRequestEvent();
	if (!locals.user) {
		error(401, "Unauthorized");
	}
	return locals.user;
}
