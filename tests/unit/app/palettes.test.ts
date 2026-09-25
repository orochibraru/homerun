import { describe, expect, test } from "bun:test";
import { appearanceCss, PALETTES } from "$lib/palettes";

describe("appearanceCss", () => {
	test("is empty for the built-in default", () => {
		expect(appearanceCss({ accentColor: null, palette: null })).toBe("");
	});

	test("a palette sets the accent, every chart hue and the aurora", () => {
		const ocean = PALETTES.find((p) => p.id === "ocean");
		const css = appearanceCss({ accentColor: "#ff0000", palette: "ocean" });
		expect(css).toContain(`--color-accent:${ocean?.accent}`);
		expect(css).toContain(`--chart-1:${ocean?.charts[0]}`);
		expect(css).toContain(`--chart-5:${ocean?.charts[4]}`);
		expect(css).toContain(`--brand-2:${ocean?.charts[1]}`);
		expect(css).not.toContain("#ff0000");
	});

	test("a custom accent sets the accent alone", () => {
		const css = appearanceCss({ accentColor: "#22c55e", palette: null });
		expect(css).toContain("--color-accent:#22c55e");
		expect(css).toContain("rgba(34,197,94,0.12)");
		expect(css).not.toContain("--chart-1");
	});

	test("never injects a stored value that isn't a palette or a hex colour", () => {
		expect(
			appearanceCss({ accentColor: "red;}body{display:none", palette: null }),
		).toBe("");
		expect(appearanceCss({ accentColor: null, palette: "nope" })).toBe("");
	});
});
