import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { OauthClientDTO } from "$lib/dto/oauth-client-dto";
import { Logger } from "$lib/logger";
import { adminApp } from "$lib/server/oauth-app-admin";
import {
	authErrorMessage,
	OauthAppService,
} from "$lib/services/oauth-app.service";
import {
	OAUTH_TEST_COOKIE,
	OauthTestService,
} from "$lib/services/oauth-test.service";

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

	test: async ({ cookies, locals, params, request, url }) => {
		const app = await adminApp(locals, params.appId);
		const origin = config.auth.origin;
		if (!origin) {
			return fail(400, {
				error: "Set the Dashboard URL under Settings → General first.",
			});
		}
		try {
			await OauthAppService.syncCallbacks(app.clientId, request.headers);
		} catch (err) {
			return fail(400, {
				error: authErrorMessage(err, "Couldn't register the test callback."),
			});
		}
		const { authorizeUrl, state } = await OauthTestService.start(app, origin);
		cookies.set(OAUTH_TEST_COOKIE, JSON.stringify(state), {
			httpOnly: true,
			maxAge: 600,
			path: "/idp",
			sameSite: "lax",
			secure: url.protocol === "https:",
		});
		logger.info(
			`OAuth app test sign-in started: client=${app.clientId} user=${locals.user?.id}`,
		);
		throw redirect(303, authorizeUrl);
	},
};
