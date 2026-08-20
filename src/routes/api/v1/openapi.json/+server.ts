import { json } from "@sveltejs/kit";
import { buildOpenApiDocument } from "$lib/openapi/build";

/**
 * Public on purpose (no auth check) — the spec itself doesn't expose any
 * data, only shapes, same as any other API's published OpenAPI document.
 * Every documented route still enforces its own auth independently.
 */
export const GET = async ({ url }) => {
	return json(buildOpenApiDocument(url.origin));
};
