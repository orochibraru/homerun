import { apiCaller } from "#lib/server/api-route.js";
import { tracePage } from "#lib/server/trace-api.js";

export const GET = async ({ locals, url }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	return await tracePage({ instance: true }, url);
};
