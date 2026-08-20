import { redirect } from "@sveltejs/kit";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { GitProviderService } from "$lib/services/git-provider.service";

export const GET = async ({ params, locals, url }) => {
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

	const redirectUri = `${url.origin}/api/v1/git-providers/${provider.id}/callback`;
	const state = GitProviderService.createState(provider.id, locals.user.id);
	const authorizeUrl = GitProviderService.authorizeUrl(
		provider,
		state,
		redirectUri,
	);

	throw redirect(302, authorizeUrl);
};
