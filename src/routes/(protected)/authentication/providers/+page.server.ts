import { oauthMethod } from "$lib/auth-providers";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { ServiceDTO } from "$lib/dto/service-dto";

export const load = async ({ parent }) => {
	await parent();
	const [settings, services] = await Promise.all([
		InstanceSettingsDTO.get(),
		ServiceDTO.list(),
	]);
	const gatedMethods = services
		.filter((svc) => svc.authRequired)
		.map((svc) => svc.authProviders);
	return {
		providers: settings.toJSON().oauthProviders.map((p) => ({
			clientId: p.clientId,
			discoveryUrl: p.discoveryUrl,
			enabled: p.enabled,
			label: p.label || p.name,
			name: p.name,
			usedBy: gatedMethods.filter((methods) =>
				methods.includes(oauthMethod(p.name)),
			).length,
		})),
	};
};
