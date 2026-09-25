import { config } from "$lib/config";
import { OauthClientDTO } from "$lib/dto/oauth-client-dto";
import { oidcDiscoveryUrl } from "$lib/oidc-provider";

export const load = async ({ parent }) => {
	await parent();
	const oauthApps = await OauthClientDTO.list();
	return {
		oauthApps: oauthApps.map((app) => app.summary()),
		oidcDiscoveryUrl: config.auth.origin
			? oidcDiscoveryUrl(config.auth.origin)
			: null,
	};
};
