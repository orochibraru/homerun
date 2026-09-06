import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { parseOauthProviderForm } from "$lib/server/oauth-provider-form";
import { applyAndRebuild } from "$lib/server/validation/instance-settings-form";

const logger = new Logger("InstanceSettings");

export const load = ({ locals }) => {
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}
	return { callbackBase: config.auth.origin ?? null };
};

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		const formData = await request.formData();
		const settings = await InstanceSettingsDTO.get();
		const taken = settings.toJSON().oauthProviders.map((p) => p.name);
		const parsed = await parseOauthProviderForm(formData, taken);
		if (!parsed.input) {
			return fail(400, {
				error: parsed.error,
				values: Object.fromEntries(formData),
			});
		}

		await settings.addOauthProvider(parsed.input);
		applyAndRebuild(settings);
		logger.info(
			`OAuth provider added: name=${parsed.input.name} user=${locals.user.id}`,
		);
		throw redirect(
			303,
			`${resolve("/authentication")}/${encodeURIComponent(parsed.input.name)}`,
		);
	},
};
