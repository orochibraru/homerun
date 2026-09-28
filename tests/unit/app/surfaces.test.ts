import { describe, expect, test } from "bun:test";
import {
	effectiveSurface,
	isPreset,
	isSurfaceStyle,
	PRESETS,
	SURFACE_STYLES,
} from "../../../src/lib/surfaces";

describe("isSurfaceStyle", () => {
	test("accepts every listed style and nothing else", () => {
		for (const style of SURFACE_STYLES) {
			expect(isSurfaceStyle(style.id)).toBe(true);
		}
		expect(isSurfaceStyle("flat")).toBe(false);
		expect(isSurfaceStyle(null)).toBe(false);
	});
});

describe("effectiveSurface", () => {
	test("a preset wins over the style, an unknown one falls back", () => {
		expect(effectiveSurface({ preset: "win95", surfaceStyle: "clay" })).toBe(
			"win95",
		);
		expect(effectiveSurface({ preset: null, surfaceStyle: "clay" })).toBe(
			"clay",
		);
		expect(effectiveSurface({ preset: "win2000", surfaceStyle: "clay" })).toBe(
			"clay",
		);
		expect(effectiveSurface({ preset: null, surfaceStyle: "gone" })).toBe(
			"glass",
		);
	});

	test("every preset is recognised", () => {
		for (const preset of PRESETS) {
			expect(isPreset(preset.id)).toBe(true);
		}
		expect(isPreset("glass")).toBe(false);
	});
});
