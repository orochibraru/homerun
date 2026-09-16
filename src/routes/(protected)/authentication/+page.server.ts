import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { oauthMethod } from "$lib/auth-providers";
import { config, isSmtpEnabled } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { OauthClientDTO } from "$lib/dto/oauth-client-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { oidcDiscoveryUrl } from "$lib/oidc-provider";
import { checkbox } from "$lib/server/validation/instance-settings-form";
import { PASSKEY_SIGN_IN, PASSWORD_SIGN_IN } from "$lib/sign-in-methods";

const PREFERRED_FIELD_PREFIX = "preferred:";

export const load = async ({ locals, parent }) => {
	const { user } = await parent();
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}

	const [settings, services, oauthApps] = await Promise.all([
		InstanceSettingsDTO.get(),
		ServiceDTO.list(user.id),
		OauthClientDTO.list(),
	]);

	const gated = services
		.filter((svc) => svc.authRequired)
		.map((svc) => ({
			id: svc.id,
			methods: svc.authProviders,
			name: svc.name,
		}));

	return {
		callbackBase: config.auth.origin ?? null,
		gatedServices: gated,
		oauthApps: oauthApps.map((app) => app.summary()),
		oidcDiscoveryUrl: config.auth.origin
			? oidcDiscoveryUrl(config.auth.origin)
			: null,
		providers: settings.toJSON().oauthProviders.map((p) => ({
			clientId: p.clientId,
			discoveryUrl: p.discoveryUrl,
			enabled: p.enabled,
			label: p.label || p.name,
			name: p.name,
			usedBy: gated.filter((svc) => svc.methods.includes(oauthMethod(p.name)))
				.length,
		})),
		preferredSignInMethods: settings.preferredSignInMethods,
		securityPolicy: settings.securityPolicy,
		signInMethods: [
			{
				helperText: "Email and password form.",
				label: "Email and password",
				method: PASSWORD_SIGN_IN,
			},
			{
				helperText: "One-tap sign-in with a registered passkey.",
				label: "Passkey",
				method: PASSKEY_SIGN_IN,
			},
			...settings
				.toJSON()
				.oauthProviders.filter((p) => p.enabled)
				.map((p) => ({
					helperText: "OAuth / OIDC single sign-on.",
					label: p.label || p.name,
					method: oauthMethod(p.name),
				})),
		],
		smtpEnabled: isSmtpEnabled(),
	};
};

export const actions = {
	preferredSignIn: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			return fail(403, {
				error: "Only admins can change the preferred sign-in methods.",
			});
		}
		const formData = await request.formData();
		const settings = await InstanceSettingsDTO.get();
		await settings.updatePreferredSignInMethods(
			[...formData.keys()]
				.filter((key) => key.startsWith(PREFERRED_FIELD_PREFIX))
				.filter((key) => formData.get(key) === "on")
				.map((key) => key.slice(PREFERRED_FIELD_PREFIX.length)),
		);
		return { saved: true };
	},
	securityPolicy: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			return fail(403, {
				error: "Only admins can change sign-in requirements.",
			});
		}
		const formData = await request.formData();
		const settings = await InstanceSettingsDTO.get();
		await settings.updateSecurityPolicy({
			requirePasskey: checkbox(formData, "requirePasskey"),
			requireTwoFactor: checkbox(formData, "requireTwoFactor"),
		});
		return { saved: true };
	},
};
