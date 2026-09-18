import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { convertGithubAppManifest } from "$lib/github-app";
import { Logger } from "$lib/logger";
import { GitProviderService } from "$lib/services/git-provider.service";

const logger = new Logger("GitProviders");

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		throw redirect(302, resolve("/auth/sign-in"));
	}
	if (!locals.isAdmin) {
		return new Response("Forbidden", { status: 403 });
	}
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	if (!(code && state)) {
		return new Response("Missing code/state.", { status: 400 });
	}
	if (
		!GitProviderService.verifyState(state, params.providerId, locals.user.id)
	) {
		return new Response("Invalid or expired state.", { status: 400 });
	}

	const settings = await InstanceSettingsDTO.get();
	if (settings.gitProviders.some((p) => p.id === params.providerId)) {
		throw redirect(303, resolve("/git-providers"));
	}

	const app = await convertGithubAppManifest(code);
	await settings.updateGitProviders([
		...settings.gitProviders.map((p) => ({
			baseUrl: p.baseUrl,
			clientId: p.clientId,
			enabled: p.enabled,
			id: p.id,
			kind: p.kind,
			name: p.name,
		})),
		{
			baseUrl: null,
			clientId: app.clientId,
			clientSecret: app.clientSecret,
			enabled: true,
			id: params.providerId,
			kind: "github",
			name: app.name,
		},
	]);
	logger.info(
		`GitHub App created: provider=${params.providerId} app=${app.name} by=${locals.user.id}`,
	);

	throw redirect(303, `${app.htmlUrl}/installations/new`);
};
