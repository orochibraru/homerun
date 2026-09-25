import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import { mcpAllowed, mcpResource, oidcIssuer } from "$lib/oidc-provider";
import { parseOauthAppForm } from "$lib/server/oauth-app-form";
import {
	authErrorMessage,
	OauthAppService,
} from "$lib/services/oauth-app.service";

const logger = new Logger("OidcProvider");

export const load = ({ locals }) => {
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}
	const origin = config.auth.origin;
	return {
		issuer: origin ? oidcIssuer(origin) : null,
		mcpUrl: origin && mcpAllowed(origin) ? mcpResource(origin) : null,
	};
};

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		if (!config.auth.origin) {
			return fail(400, {
				error:
					"Set the Dashboard URL under Settings → General first: it's the issuer apps sign in against.",
			});
		}

		const parsed = parseOauthAppForm(await request.formData());
		if (!parsed.input) {
			return fail(400, { error: parsed.error });
		}

		try {
			const created = await OauthAppService.create(
				parsed.input,
				request.headers,
			);
			logger.info(
				`OAuth app registered: client=${created.clientId} name=${parsed.input.name} user=${locals.user.id}`,
			);
			return { created: { ...created, name: parsed.input.name } };
		} catch (err) {
			logger.warn(
				`OAuth app registration failed: name=${parsed.input.name}`,
				err,
			);
			return fail(400, {
				error: authErrorMessage(err, "Couldn't register the app."),
			});
		}
	},
};
