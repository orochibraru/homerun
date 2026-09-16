import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { GitWebhookService } from "$lib/services/git-webhook.service";

export const POST = async ({ params, request }) => {
	const svc = await ServiceDTO.getForWebhook(params.serviceId);
	const result = await GitWebhookService.handleDelivery(
		svc,
		request.headers,
		await request.text(),
	);
	if (result.status === "rejected") {
		return json({ error: result.reason }, { status: result.code });
	}
	if (result.status === "ignored") {
		return json({ ignored: result.reason }, { status: 202 });
	}
	return json(
		{ deploymentId: result.deploymentId, jobId: result.jobId },
		{ status: 202 },
	);
};
