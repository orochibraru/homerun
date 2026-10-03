import { config } from "#lib/config.js";
import { OauthClientDTO } from "#lib/dto/oauth-client-dto.js";
import { OauthGrantDTO } from "#lib/dto/oauth-grant-dto.js";
import { oidcEndpointBase, oidcIssuer } from "#lib/oidc-provider.js";

export const load = async ({ parent }) => {
	await parent();
	const [apps, activity] = await Promise.all([
		OauthClientDTO.list(),
		OauthGrantDTO.activityByClient(),
	]);
	return {
		endpointBase: config.auth.origin
			? oidcEndpointBase(config.auth.origin)
			: null,
		issuer: config.auth.origin ? oidcIssuer(config.auth.origin) : null,
		oauthApps: apps.map((app) => {
			const summary = app.summary();
			return {
				...summary,
				lastUsedAt: activity.get(summary.clientId)?.lastUsedAt ?? null,
				users: activity.get(summary.clientId)?.users ?? 0,
			};
		}),
	};
};
