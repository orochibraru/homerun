import { redirect } from "@sveltejs/kit";

/** `/docs` itself has no content of its own, send visitors straight to the first guide in reading order. */
export const load = () => {
	redirect(307, "/docs/getting-started");
};
