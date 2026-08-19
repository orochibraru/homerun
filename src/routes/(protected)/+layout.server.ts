import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, resolve("/auth/sign-in"));

	return {
		user: locals.user,
	};
};
