import { error } from "@sveltejs/kit";
import { config } from "$lib/config";
import { OauthClientDTO } from "$lib/dto/oauth-client-dto";
import { OauthGrantDTO } from "$lib/dto/oauth-grant-dto";
import { oidcIssuer } from "$lib/oidc-provider";

export const load = async ({ params, parent }) => {
	await parent();
	const app = await OauthClientDTO.get(params.appId);
	if (!app) {
		error(404, "That app isn't registered.");
	}
	const activity = (await OauthGrantDTO.activityByClient()).get(app.clientId);
	return {
		activity: {
			lastUsedAt: activity?.lastUsedAt ?? null,
			users: activity?.users ?? 0,
		},
		app: app.summary(),
		issuer: config.auth.origin ? oidcIssuer(config.auth.origin) : null,
	};
};
