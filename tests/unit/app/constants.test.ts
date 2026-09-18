import { describe, expect, test } from "bun:test";
import {
	TEMPLATE_CATEGORY_COLORS,
	TEMPLATE_CATEGORY_ICONS,
	templateCategoryColor,
	templateCategoryIcon,
} from "../../../src/lib/constants";

describe("templateCategoryIcon", () => {
	test("returns the category's own icon", () => {
		expect(templateCategoryIcon("database")).toBe(
			TEMPLATE_CATEGORY_ICONS.database,
		);
	});

	test("falls back to the same generic icon for unknown and missing categories", () => {
		const fallback = templateCategoryIcon(null);
		expect(fallback).toBeDefined();
		expect(templateCategoryIcon("nope")).toBe(fallback);
		expect(Object.values(TEMPLATE_CATEGORY_ICONS)).not.toContain(fallback);
	});
});

describe("templateCategoryColor", () => {
	test("returns the category's own colours", () => {
		expect(templateCategoryColor("media")).toBe(TEMPLATE_CATEGORY_COLORS.media);
	});

	test("falls back to the accent colours", () => {
		const accent = { bg: "bg-accent-light", text: "text-accent" };
		expect(templateCategoryColor(null)).toEqual(accent);
		expect(templateCategoryColor("nope")).toEqual(accent);
	});
});
