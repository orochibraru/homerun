export interface Palette {
	accent: string;
	charts: [string, string, string, string, string];
	id: string;
	name: string;
}

export const PALETTES: Palette[] = [
	{
		accent: "#0b6fa4",
		charts: ["#0b8ac0", "#14b8a6", "#6366f1", "#38bdf8", "#f59e0b"],
		id: "ocean",
		name: "Ocean",
	},
	{
		accent: "#2f7d4f",
		charts: ["#3f9e62", "#84cc16", "#14b8a6", "#b45309", "#0ea5e9"],
		id: "forest",
		name: "Forest",
	},
	{
		accent: "#c2410c",
		charts: ["#ea580c", "#f59e0b", "#e11d48", "#a855f7", "#0891b2"],
		id: "sunset",
		name: "Sunset",
	},
	{
		accent: "#6d28d9",
		charts: ["#7c3aed", "#c026d3", "#2563eb", "#10b981", "#f59e0b"],
		id: "grape",
		name: "Grape",
	},
	{
		accent: "#be185d",
		charts: ["#db2777", "#f472b6", "#8b5cf6", "#06b6d4", "#f59e0b"],
		id: "rose",
		name: "Rose",
	},
	{
		accent: "#334155",
		charts: ["#475569", "#0ea5e9", "#22c55e", "#f97316", "#a855f7"],
		id: "graphite",
		name: "Graphite",
	},
];

const HEX = /^#[0-9a-fA-F]{6}$/;

function accentVars(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `--color-accent:${hex};--color-ink:${hex};--primary:${hex};--color-accent-light:rgba(${r},${g},${b},0.12);--color-accent-glow:rgba(${r},${g},${b},0.35);--ring:rgba(${r},${g},${b},0.55);`;
}

/**
 * The CSS that overrides the theme's colours for a user's appearance choice:
 * a palette's accent, chart hues and background aurora, or a custom accent
 * alone. Empty for the built-in default, and for anything that isn't a known
 * palette or a `#rrggbb` colour, so a bad stored value falls back instead of
 * injecting CSS.
 */
export function appearanceCss(preferences: {
	accentColor: string | null;
	palette: string | null;
}): string {
	const palette = PALETTES.find((p) => p.id === preferences.palette);
	if (palette) {
		const charts = palette.charts
			.map((hex, index) => `--chart-${index + 1}:${hex};`)
			.join("");
		return `:root:root{${accentVars(palette.accent)}${charts}--brand-2:${palette.charts[1]};--brand-3:${palette.charts[2]};}`;
	}
	const hex = preferences.accentColor ?? "";
	return HEX.test(hex) ? `:root:root{${accentVars(hex)}}` : "";
}
