import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { GitProviderService } from "$lib/services/git-provider.service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("GitProviders");

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		throw redirect(302, resolve("/auth/sign-in"));
	}

	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const oauthError = url.searchParams.get("error");

	if (oauthError) {
		logger.warn(`OAuth error from provider: ${oauthError}`);
		throw redirect(303, resolve("/git-providers"));
	}
	if (!(code && state)) {
		return new Response("Missing code/state.", { status: 400 });
	}
	if (
		!GitProviderService.verifyState(state, params.providerId, locals.user.id)
	) {
		return new Response("Invalid or expired state.", { status: 400 });
	}

	const settings = await InstanceSettingsDTO.get();
	const provider = settings.gitProviders.find(
		(p) => p.id === params.providerId,
	);
	if (!provider) {
		return new Response("Git provider not found.", { status: 404 });
	}

	try {
		const redirectUri = `${url.origin}/api/v1/git-providers/${provider.id}/callback`;
		const exchanged = await GitProviderService.exchangeCode(
			provider,
			code,
			redirectUri,
		);

		await GitConnectionDTO.upsert({
			accessTokenEnc: encryptSecret(exchanged.accessToken),
			expiresAt: exchanged.expiresAt,
			providerId: provider.id,
			providerKind: provider.kind,
			providerUsername: exchanged.providerUsername,
			refreshTokenEnc: exchanged.refreshToken
				? encryptSecret(exchanged.refreshToken)
				: null,
			userId: locals.user.id,
		});

		logger.info(
			`Git provider connected: provider=${provider.id} kind=${provider.kind} account=${exchanged.providerUsername} user=${locals.user.id}`,
		);
	} catch (err) {
		logger.error(
			`Git provider connect failed: provider=${provider.id} user=${locals.user.id}`,
			err,
		);
	}

	throw redirect(303, resolve("/git-providers"));
};
