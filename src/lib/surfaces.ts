export const SURFACE_STYLES = [
	{
		description:
			"Flat and crisp: one solid content panel, hairline borders, a faint wash of your colour.",
		id: "sleek",
		name: "Sleek",
	},
	{
		description:
			"Liquid glass: blurred, sheened panels and pill buttons with lit edges over your colour.",
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
	{
		description:
			"Google's Material You: tonal surfaces from your colour, pill buttons, filled fields.",
		id: "material",
		name: "Material You",
	},
] as const;

export type SurfaceStyle = (typeof SURFACE_STYLES)[number]["id"];

export const PRESETS = [
	{
		description: "Bevelled grey windows on a teal desktop, navy title bars.",
		id: "win95",
		name: "Windows 95",
	},
	{
		description: "The same bevels with gradient title bars and Tahoma.",
		id: "win98",
		name: "Windows 98",
	},
	{
		description: "Luna blue title bars and beige windows over the green hill.",
		id: "winxp",
		name: "Windows XP",
	},
	{
		description: "Aero glass windows and glossy buttons on a blue desktop.",
		id: "win7",
		name: "Windows 7",
	},
	{
		description: "Messenger blues, soft gradients and glossy pill buttons.",
		id: "msn",
		name: "MSN",
	},
	{
		description: "A green phosphor terminal with scanlines, all monospace.",
		id: "retro",
		name: "Retro",
	},
] as const;

export type Preset = (typeof PRESETS)[number]["id"];

export type SurfaceId = SurfaceStyle | Preset;

export const DEFAULT_SURFACE: SurfaceStyle = "sleek";

/** Whether `value` is one of the surface styles, for a stored or submitted value that might not be. */
export function isSurfaceStyle(value: unknown): value is SurfaceStyle {
	return SURFACE_STYLES.some((style) => style.id === value);
}

/** Whether `value` is one of the presets. */
export function isPreset(value: unknown): value is Preset {
	return PRESETS.some((preset) => preset.id === value);
}

/**
 * The look the page is drawn in: the preset when one is picked, since it
 * brings its own theme, style and colors, otherwise the chosen style, falling
 * back to glass for anything unknown.
 */
export function effectiveSurface(preferences: {
	preset: string | null;
	surfaceStyle: string;
}): SurfaceId {
	if (isPreset(preferences.preset)) {
		return preferences.preset;
	}
	return isSurfaceStyle(preferences.surfaceStyle)
		? preferences.surfaceStyle
		: DEFAULT_SURFACE;
}
