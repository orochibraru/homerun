import { defineParams } from "@sveltejs/kit/params";

/** Matches a route segment made only of digits, such as a Sentry project id. */
function matchInteger(param: string): boolean {
	return /^\d+$/.test(param);
}

export const params = defineParams({
	integer: (param) => (matchInteger(param) ? param : undefined),
});
