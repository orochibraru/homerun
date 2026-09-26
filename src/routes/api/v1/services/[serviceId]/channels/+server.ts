import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { releaseChannelsApiBody } from "$lib/server/validation/api";
import { GitWebhookService } from "$lib/services/git-webhook.service";
import {
	ReleaseChannelError,
	ReleaseChannelService,
} from "$lib/services/release-channel.service";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	return json(await ReleaseChannelService.status(svc));
};

export const PATCH = async ({ params, locals, request }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "The body isn't valid JSON." }, { status: 400 });
	}
	const result = releaseChannelsApiBody.safeParse(body);
	if (!result.success) {
		return json(result.error.flatten(), { status: 400 });
	}
	const previous = {
		channelsEnabled: svc.toJSON().channelsEnabled,
		gitProviderId: svc.gitProviderId,
		gitRepo: svc.gitRepo,
		gitWebhookId: svc.gitWebhookId,
	};
	try {
		await ReleaseChannelService.configure(svc, result.data, locals.user.id);
	} catch (err) {
		if (err instanceof ReleaseChannelError) {
			return json({ error: err.message }, { status: 400 });
		}
		throw err;
	}
	await GitWebhookService.sync(svc, previous);
	return json(await ReleaseChannelService.status(svc));
};
