import { ServiceDTO } from "#lib/dto/service-dto.js";
import { GitWebhookService } from "#lib/services/git-webhook.service.js";

export const POST = async ({ params, request }) => {
	const svc = await ServiceDTO.get(params.serviceId);
	const result = await GitWebhookService.handleDelivery(
		svc,
		request.headers,
		await request.text(),
	);
	if (result.status === "rejected") {
		return Response.json({ error: result.reason }, { status: result.code });
	}
	if (result.status === "ignored") {
		return Response.json({ ignored: result.reason }, { status: 202 });
	}
	if (result.status === "removed") {
		return Response.json(
			{ removedServiceId: result.serviceId },
			{ status: 202 },
		);
	}
	return Response.json(
		{ deploymentId: result.deploymentId, jobId: result.jobId },
		{ status: 202 },
	);
};
