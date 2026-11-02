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

/** The one look the dashboard is drawn in when no preset overrides it. */
export const DEFAULT_SURFACE = "lanes";

export type SurfaceId = typeof DEFAULT_SURFACE | Preset;

/** Whether `value` is one of the presets. */
export function isPreset(value: unknown): value is Preset {
	return PRESETS.some((preset) => preset.id === value);
}

/**
 * The look the page is drawn in: the preset when one is picked, since it
 * brings its own theme, style and colors, otherwise Lanes.
 */
export function effectiveSurface(preferences: {
	preset: string | null;
}): SurfaceId {
	return isPreset(preferences.preset) ? preferences.preset : DEFAULT_SURFACE;
}
