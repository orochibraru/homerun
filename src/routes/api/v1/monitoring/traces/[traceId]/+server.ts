import { apiCaller } from "#lib/server/api-route.js";
import { traceSpans } from "#lib/server/trace-api.js";

export const GET = async ({ params, locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	return await traceSpans({ instance: true }, params.traceId);
};
