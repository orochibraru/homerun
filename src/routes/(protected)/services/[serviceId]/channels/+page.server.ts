import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { canarySlug } from "$lib/release-channels";
import { defaultHostname } from "$lib/service-domains";
import { GitWebhookService } from "$lib/services/git-webhook.service";
import {
	ReleaseChannelError,
	ReleaseChannelService,
} from "$lib/services/release-channel.service";

export const load = async ({ params }) => {
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		error(404, "Service not found");
	}
	const stack = svc.stackId ? await StackDTO.get(svc.stackId) : null;
	return {
		channels: await ReleaseChannelService.status(svc),
		defaultCanaryHostname: defaultHostname(
			canarySlug(svc.slug),
			stack?.slug,
			config.baseDomain,
		),
		pushWebhook: await GitWebhookService.describe(svc),
	};
};

export const actions = {
	updateChannels: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const formData = await request.formData();
		const previous = {
			channelsEnabled: svc.toJSON().channelsEnabled,
			gitProviderId: svc.gitProviderId,
			gitRepo: svc.gitRepo,
			gitWebhookId: svc.gitWebhookId,
		};
		try {
			await ReleaseChannelService.configure(
				svc,
				{
					branch: String(formData.get("channelBranch") ?? ""),
					canaryDomain: String(formData.get("channelCanaryDomain") ?? ""),
					enabled: formData.get("channelsEnabled") === "on",
					tagPattern: String(formData.get("channelTagPattern") ?? ""),
				},
				locals.user.id,
			);
		} catch (err) {
			if (err instanceof ReleaseChannelError) {
				return fail(400, {
					error: err.message,
					values: Object.fromEntries(formData),
				});
			}
			throw err;
		}
		await GitWebhookService.sync(svc, previous);
		return { success: true };
	},

	deploy: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const environment = (await request.formData()).get("environment");
		try {
			await (environment === "canary"
				? ReleaseChannelService.deployCanary(svc, {
						trigger: "manual",
						userId: locals.user.id,
					})
				: ReleaseChannelService.deployStable(svc, {
						trigger: "manual",
						userId: locals.user.id,
					}));
		} catch (err) {
			if (err instanceof ReleaseChannelError) {
				return fail(400, { error: err.message });
			}
			throw err;
		}
		return { success: true };
	},
};
