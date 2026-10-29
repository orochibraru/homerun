import { ServiceDTO } from "#lib/dto/service-dto.js";
import { apiCaller, apiError } from "#lib/server/api-route.js";
import { traceSpans } from "#lib/server/trace-api.js";

export const GET = async ({ params, locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return apiError("Not found", 404);
	}
	return await traceSpans({ serviceId: svc.id }, params.traceId);
};
