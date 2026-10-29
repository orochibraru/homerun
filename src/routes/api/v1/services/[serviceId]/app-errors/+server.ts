import { AppLogDTO } from "#lib/dto/app-log-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { apiCaller, apiError } from "#lib/server/api-route.js";

export const GET = async ({ params, locals, url }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const limit = Number(url.searchParams.get("limit") ?? 50);
	if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
		return apiError("limit must be a whole number from 1 to 500.");
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return apiError("Not found", 404);
	}
	const logs = await AppLogDTO.listForService(svc.id, limit);
	return Response.json(logs.map((log) => log.toJSON()));
};
