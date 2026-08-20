import { redirect } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { resolve } from "$app/paths";

export const load = ({ locals }) => {
	// No session at all → send back to sign-up
	if (!locals.user) {
		redirect(302, resolve("/auth/sign-up"));
	}

	// Already verified → straight to the dashboard
	if (locals.user.emailVerified) {
		redirect(302, resolve("/"));
	}

	return {
		email: locals.user.email,
		/** True when running `vite dev` — enables the bypass button */
		isDev: dev,
	};
};
