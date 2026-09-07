import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { oauthMethod } from "$lib/auth-providers";
import { config, isSmtpEnabled } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { ServiceDTO } from "$lib/dto/service-dto";

export const load = async ({ locals, parent }) => {
	const { user } = await parent();
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}

	const [settings, services] = await Promise.all([
		InstanceSettingsDTO.get(),
		ServiceDTO.list(user.id),
	]);

	const gated = services
		.filter((svc) => svc.authRequired)
		.map((svc) => ({
			id: svc.id,
			methods: svc.authProviders,
			name: svc.name,
		}));

	return {
		callbackBase: config.auth.origin ?? null,
		gatedServices: gated,
		providers: settings.toJSON().oauthProviders.map((p) => ({
			clientId: p.clientId,
			discoveryUrl: p.discoveryUrl,
			enabled: p.enabled,
			label: p.label || p.name,
			name: p.name,
			usedBy: gated.filter((svc) => svc.methods.includes(oauthMethod(p.name)))
				.length,
		})),
		smtpEnabled: isSmtpEnabled(),
	};
};
