import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { hasAnyUser } from "$lib/server/onboarding";

export const load = async () => {
	const hasUsers = await hasAnyUser();
	if (!hasUsers) {
		throw redirect(302, resolve("/auth/sign-up"));
	}
};
