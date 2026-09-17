import { redirect } from "@sveltejs/kit";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { GIT_CONNECT_RETURN_COOKIE } from "$lib/git-webhooks";
import { safeRedirectTarget } from "$lib/redirect-target";
import { GitProviderService } from "$lib/services/git-provider.service";

export const GET = async ({ cookies, params, locals, url }) => {
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}

	const settings = await InstanceSettingsDTO.get();
	const provider = settings.gitProviders.find(
		(p) => p.id === params.providerId,
	);
	if (!provider?.enabled) {
		return new Response("Git provider not found.", { status: 404 });
	}

	const returnTo = safeRedirectTarget(url.searchParams.get("returnTo"));
	if (returnTo) {
		cookies.set(GIT_CONNECT_RETURN_COOKIE, returnTo, {
			httpOnly: true,
			maxAge: 600,
			path: "/",
			sameSite: "lax",
		});
	}

	const redirectUri = `${url.origin}/api/v1/git-providers/${provider.id}/callback`;
	const state = GitProviderService.createState(provider.id, locals.user.id);
	const authorizeUrl = GitProviderService.authorizeUrl(
		provider,
		state,
		redirectUri,
	);

	throw redirect(302, authorizeUrl);
};
