import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { OauthClientDTO } from "$lib/dto/oauth-client-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("OidcProvider");

export const actions = {
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
};
