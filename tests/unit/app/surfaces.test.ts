import { describe, expect, test } from "bun:test";
import { isSurfaceStyle, SURFACE_STYLES } from "../../../src/lib/surfaces";

describe("isSurfaceStyle", () => {
	test("accepts every listed style and nothing else", () => {
		for (const style of SURFACE_STYLES) {
			expect(isSurfaceStyle(style.id)).toBe(true);
		}
		expect(isSurfaceStyle("material")).toBe(false);
		expect(isSurfaceStyle(null)).toBe(false);
	});
});
