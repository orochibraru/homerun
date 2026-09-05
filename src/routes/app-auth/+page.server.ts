import { error, redirect } from "@sveltejs/kit";
import { oauthProviderName, PASSWORD_METHOD } from "$lib/auth-providers";
import { config } from "$lib/config";
import {
	GATE_CALLBACK_PATH,
	GATE_GRANT_TTL_MS,
	signGateToken,
	verifyGateToken,
} from "$lib/server/app-gate";
import { gatedService } from "$lib/server/gated-service-cache";
import {
	ACCESS_DENIAL_MESSAGES,
	AppAccessService,
} from "$lib/services/app-access.service";

export const load = async ({ url, locals }) => {
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

	const enabledProviders = new Map(
		config.auth.oauthProviders
			.filter((p) => p.enabled)
			.map((p) => [p.name, p.name]),
	);
	const methods = svc.authProviders
		.map((method) => {
			if (method === PASSWORD_METHOD) {
				return {
					id: method,
					kind: "password" as const,
					label: "Email and password",
				};
			}
			const providerName = oauthProviderName(method);
			if (!(providerName && enabledProviders.has(providerName))) {
				return null;
			}
			return {
				id: method,
				kind: "oauth" as const,
				label: providerName,
				providerId: providerName,
			};
		})
		.filter((entry) => entry !== null);

	const base = {
		appName: svc.name,
		appUrl: request.target,
		methods,
		returnTo: `${url.pathname}${url.search}`,
	};

	if (!locals.user) {
		return { ...base, denial: null, signedInAs: null };
	}

	const decision = await AppAccessService.evaluate(svc, locals.user.id);
	if (!decision.allowed) {
		return {
			...base,
			denial: decision.reason
				? ACCESS_DENIAL_MESSAGES[decision.reason]
				: "You don't have access to this app.",
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
