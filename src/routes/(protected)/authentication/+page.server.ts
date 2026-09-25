import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { oauthMethod } from "$lib/auth-providers";
import { isSmtpEnabled } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { checkbox } from "$lib/server/validation/instance-settings-form";
import { PASSKEY_SIGN_IN, PASSWORD_SIGN_IN } from "$lib/sign-in-methods";

const PREFERRED_FIELD_PREFIX = "preferred:";

export const load = async ({ parent }) => {
	await parent();
	const settings = await InstanceSettingsDTO.get();
	return {
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
