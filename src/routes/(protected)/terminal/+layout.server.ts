import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";

export const load = async ({ locals, parent }) => {
	await parent();
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}
	return {};
};
