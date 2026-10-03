import { ServiceDTO } from "#lib/dto/service-dto.js";
import { PreviewApiService } from "#lib/services/preview-api.service.js";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	return Response.json(await PreviewApiService.list(svc));
};
