export const SURFACE_STYLES = [
	{
		description: "Frosted, translucent panels over the colour glow.",
		id: "glass",
		name: "Glass",
	},
	{
		description:
			"One flat tone, panels pushed out of it by soft light and shade.",
		id: "neumorphism",
		name: "Neumorphism",
	},
	{
		description: "Square corners, solid panels, hard edges and offset shadows.",
		id: "boxy",
		name: "Boxy",
	},
	{
		description:
			"Puffy, very round panels with inner highlights, like moulded clay.",
		id: "clay",
		name: "Claymorphism",
	},
	{
		description: "Textured, bevelled panels and buttons with a lit top edge.",
		id: "skeuomorphism",
		name: "Skeuomorphism",
	},
] as const;

export type SurfaceStyle = (typeof SURFACE_STYLES)[number]["id"];

export const DEFAULT_SURFACE: SurfaceStyle = "glass";

/** Whether `value` is one of the surface styles, for a stored or submitted value that might not be. */
export function isSurfaceStyle(value: unknown): value is SurfaceStyle {
	return SURFACE_STYLES.some((style) => style.id === value);
}
