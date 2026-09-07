import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { oauthMethod } from "$lib/auth-providers";
import { config } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { parseOauthProviderForm } from "$lib/server/oauth-provider-form";
import { applyAndRebuild } from "$lib/server/validation/instance-settings-form";

const logger = new Logger("InstanceSettings");

export const load = async ({ locals, params, parent }) => {
	const { user } = await parent();
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}

	const settings = await InstanceSettingsDTO.get();
	const provider = settings
		.toJSON()
		.oauthProviders.find((p) => p.name === params.providerId);
	if (!provider) {
		error(404, "No OAuth provider with that id.");
	}

	const services = await ServiceDTO.list(user.id);
	const method = oauthMethod(provider.name);

	return {
		callbackBase: config.auth.origin ?? null,
		provider: {
			clientId: provider.clientId,
			discoveryUrl: provider.discoveryUrl,
			enabled: provider.enabled,
			hasSecret: !!provider.clientSecretEnc,
			label: provider.label || provider.name,
			name: provider.name,
			pkce: provider.pkce,
			scopes: provider.scopes.join(", "),
			signOutOfProvider: provider.signOutOfProvider ?? false,
			tokenAuthMethod: provider.tokenAuthMethod ?? "auto",
		},
		usedBy: services
			.filter((svc) => svc.authRequired && svc.authProviders.includes(method))
			.map((svc) => ({ id: svc.id, name: svc.name })),
	};
};

export const actions = {
	delete: async ({ locals, params }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.deleteOauthProvider(params.providerId);
		applyAndRebuild(settings);
		logger.info(
			`OAuth provider deleted: name=${params.providerId} user=${locals.user.id}`,
		);
		throw redirect(303, resolve("/authentication"));
	},
	update: async ({ request, locals, params }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		const formData = await request.formData();
		formData.set("name", params.providerId);
		const settings = await InstanceSettingsDTO.get();
		const taken = settings
			.toJSON()
			.oauthProviders.map((p) => p.name)
			.filter((name) => name !== params.providerId);
		const parsed = await parseOauthProviderForm(formData, taken);
		if (!parsed.input) {
			return fail(400, { error: parsed.error });
		}

		await settings.updateOauthProvider(params.providerId, parsed.input);
		applyAndRebuild(settings);
		logger.info(
			`OAuth provider updated: name=${params.providerId} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
