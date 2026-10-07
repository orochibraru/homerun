import { error, redirect } from "@sveltejs/kit";
import { OauthClientDTO } from "#lib/dto/oauth-client-dto.js";
import { resolve } from "$app/paths";

/**
 * The registered app an IdP action works on. Write access to Users is
 * enforced by the request hook before the action runs.
 *
 * @throws A redirect to sign-in without a session, and a 404 when the app
 *   doesn't exist.
 */
export async function adminApp(
	locals: App.Locals,
	appId: string,
): Promise<OauthClientDTO> {
	if (!locals.user) {
		throw redirect(302, resolve("auth/sign-in"));
	}
	const app = await OauthClientDTO.get(appId);
	if (!app) {
		error(404, "That app isn't registered.");
	}
	return app;
}
