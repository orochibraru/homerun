import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { OauthClientDTO } from "$lib/dto/oauth-client-dto";
import { Logger } from "$lib/logger";
import { oidcIssuer } from "$lib/oidc-provider";
import { parseOauthAppForm } from "$lib/server/oauth-app-form";
import {
	authErrorMessage,
	OauthAppService,
} from "$lib/services/oauth-app.service";

const logger = new Logger("OidcProvider");

export const load = async ({ locals, params }) => {
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}
	const app = await OauthClientDTO.get(params.appId);
	if (!app) {
		error(404, "That app isn't registered.");
	}
	return {
		app: app.summary(),
		issuer: config.auth.origin ? oidcIssuer(config.auth.origin) : null,
	};
};

export const actions = {
	update: async ({ locals, params, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const app = await OauthClientDTO.get(params.appId);
		if (!app) {
			return fail(404, { error: "That app isn't registered." });
		}
		const parsed = parseOauthAppForm(await request.formData());
		if (!parsed.input) {
			return fail(400, { error: parsed.error });
		}
		try {
			await OauthAppService.update(app.clientId, parsed.input, request.headers);
		} catch (err) {
			return fail(400, {
				error: authErrorMessage(err, "Couldn't save the app."),
			});
		}
		logger.info(
			`OAuth app updated: client=${app.clientId} user=${locals.user.id}`,
		);
		return { saved: true };
	},

	toggle: async ({ locals, params }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const app = await OauthClientDTO.get(params.appId);
		if (!app) {
			return fail(404, { error: "That app isn't registered." });
		}
		const disabled = !app.summary().disabled;
		await app.setDisabled(disabled);
		logger.info(
			`OAuth app ${disabled ? "disabled" : "enabled"}: client=${app.clientId} user=${locals.user.id}`,
		);
		return { disabled };
	},

	rotate: async ({ locals, params, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const app = await OauthClientDTO.get(params.appId);
		if (!app) {
			return fail(404, { error: "That app isn't registered." });
		}
		try {
			const clientSecret = await OauthAppService.rotateSecret(
				app.clientId,
				request.headers,
			);
			logger.info(
				`OAuth app secret rotated: client=${app.clientId} user=${locals.user.id}`,
			);
			return { clientSecret };
		} catch (err) {
			return fail(400, {
				error: authErrorMessage(err, "Couldn't rotate the secret."),
			});
		}
	},

	delete: async ({ locals, params }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const app = await OauthClientDTO.get(params.appId);
		if (app) {
			await app.delete();
			logger.info(
				`OAuth app deleted: client=${app.clientId} user=${locals.user.id}`,
			);
		}
		throw redirect(303, resolve("/authentication"));
	},
};
