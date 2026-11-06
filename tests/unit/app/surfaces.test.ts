import { describe, expect, test } from "bun:test";

import {
	DEFAULT_SURFACE,
	effectiveSurface,
	isPreset,
	PRESETS,
} from "../../../src/lib/surfaces";

describe("effectiveSurface", () => {
	test("a preset wins, anything else is Lanes", () => {
		expect(effectiveSurface({ preset: "win95" })).toBe("win95");
		expect(effectiveSurface({ preset: null })).toBe(DEFAULT_SURFACE);
		expect(effectiveSurface({ preset: "win2000" })).toBe("lanes");
	});

	test("every preset is recognised", () => {
		for (const preset of PRESETS) {
			expect(isPreset(preset.id)).toBe(true);
		}
		expect(isPreset("glass")).toBe(false);
	});
});
