import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { GIT_CONNECT_RETURN_COOKIE } from "$lib/git-webhooks";
import { Logger } from "$lib/logger";
import { safeRedirectTarget } from "$lib/redirect-target";
import { browserOrigin } from "$lib/server/canonical-origin";
import { GitProviderService } from "$lib/services/git-provider.service";
import { GitWebhookService } from "$lib/services/git-webhook.service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("GitProviders");

export const GET = async ({ cookies, params, locals, request, url }) => {
	if (!locals.user) {
		throw redirect(302, resolve("/auth/sign-in"));
	}
	const returnTo = safeRedirectTarget(
		cookies.get(GIT_CONNECT_RETURN_COOKIE) ?? null,
	);
	cookies.delete(GIT_CONNECT_RETURN_COOKIE, { path: "/" });
	const done = returnTo ?? resolve("/git-providers");

	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const oauthError = url.searchParams.get("error");

	if (oauthError) {
		logger.warn(`OAuth error from provider: ${oauthError}`);
		throw redirect(303, done);
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
		const redirectUri = `${browserOrigin(request, url)}/api/v1/git-providers/${provider.id}/callback`;
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
		await GitWebhookService.retryAfterReconnect(locals.user.id, provider.id);
	} catch (err) {
		logger.error(
			`Git provider connect failed: provider=${provider.id} user=${locals.user.id}`,
			err,
		);
	}

	throw redirect(303, done);
};
