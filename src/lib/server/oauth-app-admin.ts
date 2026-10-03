import { error, redirect } from "@sveltejs/kit";
import { OauthClientDTO } from "#lib/dto/oauth-client-dto.js";
import { resolve } from "$app/paths";

/**
 * The registered app an admin-only IdP action works on.
 *
 * @throws A redirect to sign-in without a session or home for a non-admin,
 *   and a 404 when the app doesn't exist.
 */
export async function adminApp(
	locals: App.Locals,
	appId: string,
): Promise<OauthClientDTO> {
	if (!locals.user) {
		throw redirect(302, resolve("auth/sign-in"));
	}
	if (!locals.isAdmin) {
		throw redirect(302, resolve(""));
	}
	const app = await OauthClientDTO.get(appId);
	if (!app) {
		error(404, "That app isn't registered.");
	}
	return app;
}
