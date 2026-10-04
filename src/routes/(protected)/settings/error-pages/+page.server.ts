import { fail, redirect } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import {
	DEFAULT_ERROR_PAGES,
	errorPageTextsFromForm,
	isHexColor,
} from "#lib/error-pages.js";
import { Logger } from "#lib/logger.js";
import { resolve } from "$app/paths";

const logger = new Logger("InstanceSettings");

export const load = async () => {
	const settings = await InstanceSettingsDTO.get();
	return {
		defaults: DEFAULT_ERROR_PAGES,
		errorPages: settings.toJSON().errorPages ?? {},
		published: Boolean(config.traefik.dynamicConfigDir),
	};
};

function text(formData: FormData, name: string, max: number): string | null {
	const value = String(formData.get(name) ?? "").trim();
	return value ? value.slice(0, max) : null;
}

export const actions = {
	updateBranding: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const formData = await request.formData();
		const accentColor = text(formData, "accentColor", 7);
		const logoUrl = text(formData, "logoUrl", 2000);
		if (accentColor && !isHexColor(accentColor)) {
			return fail(400, { error: "The accent colour must look like #8b2942." });
		}
		if (logoUrl && !/^https?:\/\//i.test(logoUrl)) {
			return fail(400, {
				error: "The logo URL must start with http:// or https://.",
			});
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateErrorPages({
			accentColor,
			brandName: text(formData, "brandName", 60) ?? undefined,
			logoUrl,
			showPoweredBy: formData.get("showPoweredBy") === "on",
		});
		logger.info(`Error page branding updated: user=${locals.user.id}`);
		return { success: true };
	},

	updateText: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateErrorPages({
			pages: errorPageTextsFromForm(await request.formData()),
		});
		logger.info(`Error page text updated: user=${locals.user.id}`);
		return { success: true };
	},
};
