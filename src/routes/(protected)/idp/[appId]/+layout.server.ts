import { error } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { OauthClientDTO } from "#lib/dto/oauth-client-dto.js";
import { OauthClientEnvironmentDTO } from "#lib/dto/oauth-client-environment-dto.js";
import { OauthGrantDTO } from "#lib/dto/oauth-grant-dto.js";
import { oidcEndpointBase, oidcIssuer } from "#lib/oidc-provider.js";

export const load = async ({ params, parent }) => {
	await parent();
	const app = await OauthClientDTO.get(params.appId);
	if (!app) {
		error(404, "That app isn't registered.");
	}
	const [grants, environments] = await Promise.all([
		OauthGrantDTO.activityByClient(),
		OauthClientEnvironmentDTO.listForClient(app.clientId),
	]);
	const activity = grants.get(app.clientId);
	return {
		activity: {
			lastUsedAt: activity?.lastUsedAt ?? null,
			users: activity?.users ?? 0,
		},
		app: app.summary(),
		environmentCount: environments.length,
		environments: environments.map((env) => ({
			allowedOrigins: env.allowedOrigins,
			allowLocalhost: env.allowLocalhost,
			id: env.id,
			name: env.name,
			redirectUris: env.redirectUris,
		})),
		endpointBase: config.auth.origin
			? oidcEndpointBase(config.auth.origin)
			: null,
		issuer: config.auth.origin ? oidcIssuer(config.auth.origin) : null,
	};
};
