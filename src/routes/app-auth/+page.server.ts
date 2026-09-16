import { error, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { oauthProviderName, PASSWORD_METHOD } from "$lib/auth-providers";
import { config } from "$lib/config";
import { signInUrlFor } from "$lib/redirect-target";
import {
	GATE_CALLBACK_PATH,
	GATE_GRANT_TTL_MS,
	signGateToken,
	verifyGateToken,
} from "$lib/server/app-gate";
import { offCanonicalOrigin } from "$lib/server/canonical-origin";
import { gatedService } from "$lib/server/gated-service-cache";
import {
	ACCESS_DENIAL_MESSAGES,
	AppAccessService,
} from "$lib/services/app-access.service";

export const load = async ({ request: incoming, url, locals }) => {
	const canonicalOrigin = offCanonicalOrigin(incoming, url);
	if (canonicalOrigin) {
		redirect(302, `${canonicalOrigin}${url.pathname}${url.search}`);
	}

	const rd = url.searchParams.get("rd");
	const request = rd ? verifyGateToken(rd) : null;
	if (!request?.target) {
		error(
			400,
			"This sign-in link is invalid or has expired. Go back to the app and reload to get a fresh one.",
		);
	}

	const svc = await gatedService(request.serviceId);
	if (!svc?.authRequired) {
		error(404, "That app isn't gated behind Homerun's login.");
	}

	const enabledProviders = new Set(
		config.auth.oauthProviders.filter((p) => p.enabled).map((p) => p.name),
	);
	const hasUsableMethod = svc.authProviders.some((method) => {
		if (method === PASSWORD_METHOD) {
			return true;
		}
		const providerName = oauthProviderName(method);
		return providerName !== null && enabledProviders.has(providerName);
	});

	const base = { appName: svc.name, appUrl: request.target };

	if (!hasUsableMethod) {
		return { ...base, denial: null, noMethods: true, signedInAs: null };
	}

	if (!locals.user) {
		redirect(
			302,
			signInUrlFor(resolve("/auth/sign-in"), `${url.pathname}${url.search}`),
		);
	}

	const decision = await AppAccessService.evaluate(svc, locals.user.id);
	if (!decision.allowed) {
		return {
			...base,
			denial: decision.reason
				? ACCESS_DENIAL_MESSAGES[decision.reason]
				: "You don't have access to this app.",
			noMethods: false,
			signedInAs: locals.user.email,
		};
	}

	const grant = signGateToken(
		{
			email: locals.user.email,
			host: request.host,
			name: locals.user.name,
			serviceId: svc.id,
			target: request.target,
			userId: locals.user.id,
		},
		GATE_GRANT_TTL_MS,
	);
	const callback = new URL(GATE_CALLBACK_PATH, new URL(request.target).origin);
	callback.searchParams.set("token", grant);
	redirect(302, callback.toString());
};
