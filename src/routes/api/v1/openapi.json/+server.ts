import { json } from "@sveltejs/kit";
import { buildOpenApiDocument } from "$lib/openapi/build";
import { browserOrigin } from "$lib/server/canonical-origin";

/**
 * Public on purpose (no auth check) : the spec itself doesn't expose any
 * data, only shapes, same as any other API's published OpenAPI document.
 * Every documented route still enforces its own auth independently.
 */
export const GET = ({ request, url }) =>
	json(buildOpenApiDocument(browserOrigin(request, url)));
