import { z } from "zod";

/** A bare "#rrggbb" hex color, the shape a native `<input type="color">` always submits. */
const hexColorSchema = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, "Not a valid color.");

export const themeSchema = z.object({
	theme: z.enum(["light", "dark", "system"]),
});

export const sidebarColorIntensitySchema = z.object({
	sidebarColorIntensity: z.enum(["colorful", "accent"]),
});

export const accentColorSchema = z.object({
	// Blank means "reset to the built-in default".
	accentColor: z.union([z.literal(""), hexColorSchema]),
});
