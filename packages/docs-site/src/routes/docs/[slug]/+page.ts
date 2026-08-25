import { error } from "@sveltejs/kit";
import { docPages, getDocPage } from "$lib/docs-content";

/** Every known doc slug, so the static adapter can prerender each one instead of relying on the fallback 404 page for a link that should genuinely resolve. */
export function entries() {
	return docPages.map((doc) => ({ slug: doc.slug }));
}

export const load = ({ params }) => {
	const doc = getDocPage(params.slug);
	if (!doc) {
		error(404, "Doc page not found");
	}
	return { doc };
};
