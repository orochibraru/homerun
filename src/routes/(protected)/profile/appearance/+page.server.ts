import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { UserPreferencesDTO } from "$lib/dto/user-preferences-dto";
import { Logger } from "$lib/logger";
import {
	accentColorSchema,
	sidebarColorIntensitySchema,
	themeSchema,
} from "$lib/server/validation/appearance";

const logger = new Logger("Appearance");

export const actions = {
	/** Saves the site-wide light/dark/system preference. */
	updateTheme: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const parsed = themeSchema.safeParse(
			Object.fromEntries(await request.formData()),
		);
		if (!parsed.success) {
			return fail(400, { error: "Pick a valid theme." });
		}
		const prefs = await UserPreferencesDTO.get(locals.user.id);
		await prefs.updateTheme(parsed.data.theme);
		logger.info("Theme preference updated", { userId: locals.user.id });
		return { success: true };
	},

	/** Saves whether the sidebar uses per-category colors or one shared accent. */
	updateSidebar: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const parsed = sidebarColorIntensitySchema.safeParse(
			Object.fromEntries(await request.formData()),
		);
		if (!parsed.success) {
			return fail(400, { error: "Pick a valid sidebar style." });
		}
		const prefs = await UserPreferencesDTO.get(locals.user.id);
		await prefs.updateSidebarColorIntensity(parsed.data.sidebarColorIntensity);
		logger.info("Sidebar color intensity updated", { userId: locals.user.id });
		return { success: true };
	},

	/** Saves (or clears, on a blank submission) the custom accent color. */
	updateAccent: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const parsed = accentColorSchema.safeParse(
			Object.fromEntries(await request.formData()),
		);
		if (!parsed.success) {
			return fail(400, { error: "Not a valid color." });
		}
		const prefs = await UserPreferencesDTO.get(locals.user.id);
		await prefs.updateAccentColor(parsed.data.accentColor || null);
		logger.info("Accent color updated", { userId: locals.user.id });
		return { success: true };
	},
};
