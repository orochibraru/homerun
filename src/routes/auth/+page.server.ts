import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";

export const load = () => {
	redirect(302, resolve("/auth/sign-in"));
};
