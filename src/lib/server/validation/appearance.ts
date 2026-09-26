import { z } from "zod";
import { PER_PAGE_OPTIONS } from "$lib/list-sorts";
import { PALETTES } from "$lib/palettes";

/** A bare "#rrggbb" hex color, the shape a native `<input type="color">` always submits. */
const hexColorSchema = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, "Not a valid color.");

export const themeSchema = z.object({
	theme: z.enum(["light", "dark", "system"]),
});

/** The appearance page's colour choice: `palette` is a palette id, "custom" (then `accentColor` is used) or "" for the default. */
export const colorsSchema = z.discriminatedUnion("palette", [
	z.object({ palette: z.literal("") }),
	z.object({ accentColor: hexColorSchema, palette: z.literal("custom") }),
	z.object({
		palette: z.enum(PALETTES.map((p) => p.id) as [string, ...string[]]),
	}),
]);

export const perPageSchema = z.object({
	perPage: z.coerce
		.number()
		.int()
		.refine(
			(value) => (PER_PAGE_OPTIONS as readonly number[]).includes(value),
			"Pick one of the listed page sizes.",
		),
});
