import { resolve } from "$app/paths";
import { redirect } from "@sveltejs/kit";

import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { AdminService } from "#lib/services/admin.service.js";

export const load = async ({ locals }) => {
	if (locals.user) {
		throw redirect(302, resolve(""));
	}
	if (await AdminService.hasAnyUser()) {
		redirectToSignIn();
	}
};
