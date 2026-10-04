import { ServiceDTO } from "#lib/dto/service-dto.js";
import { GitWebhookService } from "#lib/services/git-webhook.service.js";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const details = await GitWebhookService.describe(svc);
	if (!details) {
		return Response.json(
			{
				error:
					"Neither deploy on push nor pull request previews are turned on for this service.",
			},
			{ status: 404 },
		);
	}
	return Response.json(details);
};
