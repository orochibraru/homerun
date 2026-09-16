import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { GitWebhookService } from "$lib/services/git-webhook.service";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const details = await GitWebhookService.describe(svc);
	if (!details) {
		return json(
			{ error: "Deploy on push isn't turned on for this service." },
			{ status: 404 },
		);
	}
	return json(details);
};
