import { fail, redirect } from "@sveltejs/kit";
import { OauthClientDTO } from "#lib/dto/oauth-client-dto.js";
import { Logger } from "#lib/logger.js";
import { parseOauthAppSettings } from "#lib/server/oauth-app-form.js";
import {
	authErrorMessage,
	OauthAppService,
} from "#lib/services/oauth-app.service.js";
import { resolve } from "$app/paths";

const logger = new Logger("OidcProvider");

export const actions = {
	update: async ({ locals, params, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const app = await OauthClientDTO.get(params.appId);
		if (!app) {
			return fail(404, { error: "That app isn't registered." });
		}
		const parsed = parseOauthAppSettings(await request.formData());
		if (!parsed.input) {
			return fail(400, { error: parsed.error });
		}
		try {
			await OauthAppService.update(app.clientId, parsed.input, request.headers);
			if (app.summary().confidential) {
				await app.setRequirePkce(parsed.input.requirePkce);
				await app.setTokenEndpointAuthMethod(parsed.input.tokenAuthMethod);
			}
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

	delete: async ({ locals, params }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const app = await OauthClientDTO.get(params.appId);
		if (app) {
			await app.delete();
			logger.info(
				`OAuth app deleted: client=${app.clientId} user=${locals.user.id}`,
			);
		}
		throw redirect(303, resolve("idp"));
	},
};
