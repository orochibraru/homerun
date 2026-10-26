import { resolve } from "$app/paths";
import { redirect } from "@sveltejs/kit";

export const load = () => {
	redirect(302, resolve("auth/sign-in"));
};
