import { json } from "@sveltejs/kit";
import { ImageScanDTO } from "$lib/dto/image-scan-dto";
import { ServiceDTO } from "$lib/dto/service-dto";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const scan = await ImageScanDTO.getForService(svc.id, params.scanId);
	if (!scan) {
		return json({ error: "Not found" }, { status: 404 });
	}
	return json(scan.toJSON());
};
