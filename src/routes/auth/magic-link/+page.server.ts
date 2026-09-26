import { REDIRECT_TO_PARAM, safeRedirectTarget } from "$lib/redirect-target";
import { gatedAppNameFor } from "$lib/server/app-gate-return";
import { magicLinkEmail } from "$lib/services/email-sign-in";

export const load = async ({ url }) => {
	const token = url.searchParams.get("token") ?? "";
	const redirectTo = safeRedirectTarget(
		url.searchParams.get(REDIRECT_TO_PARAM),
	);
	return {
		appName: await gatedAppNameFor(redirectTo),
		email: token ? await magicLinkEmail(token) : null,
		redirectTo,
		token,
	};
};
