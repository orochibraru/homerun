import { ImageScanDTO } from "#lib/dto/image-scan-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const scan = await ImageScanDTO.getForService(svc.id, params.scanId);
	if (!scan) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	return Response.json(scan.toJSON());
};
