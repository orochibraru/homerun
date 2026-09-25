import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { UserPreferencesDTO } from "$lib/dto/user-preferences-dto";
import { Logger } from "$lib/logger";
import { colorsSchema, themeSchema } from "$lib/server/validation/appearance";

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

	/** Saves the palette, the custom accent colour, or the built-in default. */
	updateColors: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const parsed = colorsSchema.safeParse(
			Object.fromEntries(await request.formData()),
		);
		if (!parsed.success) {
			return fail(400, { error: "Pick a palette or a valid color." });
		}
		const prefs = await UserPreferencesDTO.get(locals.user.id);
		const choice = parsed.data;
		if (choice.palette === "") {
			await prefs.updateColors(null);
		} else if (choice.palette === "custom" && "accentColor" in choice) {
			await prefs.updateColors({ accentColor: choice.accentColor });
		} else {
			await prefs.updateColors({ palette: choice.palette });
		}
		logger.info("Colors updated", { userId: locals.user.id });
		return { success: true };
	},
};
