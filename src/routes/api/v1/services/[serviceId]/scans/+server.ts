import { ImageScanDTO } from "#lib/dto/image-scan-dto.js";
import { JobDTO } from "#lib/dto/job-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { jsonPage, parseApiListQuery } from "#lib/server/api-pagination.js";
import { ImageScanService } from "#lib/services/image-scan.service.js";

const logger = new Logger("API");

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const paged = await ImageScanDTO.listForServicePaged(
		svc.id,
		parseApiListQuery(url),
	);
	return jsonPage(
		paged.items.map((scan) => scan.toSummary()),
		paged,
	);
};

export const POST = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	if (!(svc.containerId || svc.swarmServiceId)) {
		return Response.json(
			{
				error: "Deploy the service first : there's no deployed image to scan.",
			},
			{ status: 400 },
		);
	}
	const active = await JobDTO.findActive("image_scan", `image_scan:${svc.id}`);
	if (active) {
		return Response.json(
			{
				error: "A scan of this service is already queued or running.",
				jobId: active.id,
			},
			{ status: 409 },
		);
	}
	const job = await ImageScanService.enqueueScan(svc, locals.user.id);
	logger.info(
		`Image scan queued via API: service=${svc.id} job=${job.id} user=${locals.user.id}`,
	);
	return Response.json({ jobId: job.id, status: job.status }, { status: 202 });
};
