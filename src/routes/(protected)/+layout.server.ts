import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";

export const load = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, resolve("/auth/sign-in"));
	}

	return {
		user: locals.user,
	};
};
