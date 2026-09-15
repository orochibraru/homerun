import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { parseTags } = await import(
	"../../../src/lib/server/validation/template"
);
const { BUILTIN_TEMPLATES } = await import(
	"../../../src/lib/server/db/builtin-templates"
);
const { BUILTIN_TEMPLATES_APPS } = await import(
	"../../../src/lib/server/db/builtin-templates-apps"
);

describe("parseTags", () => {
	test("splits, trims and lowercases what the Tags field holds", () => {
		expect(parseTags("SQL, Database ,relational")).toEqual([
			"sql",
			"database",
			"relational",
		]);
	});

	test("drops empties and duplicates rather than storing them", () => {
		expect(parseTags("sql,,sql, ,SQL")).toEqual(["sql"]);
		expect(parseTags("")).toEqual([]);
		expect(parseTags(null)).toEqual([]);
	});

	test("caps one pasted essay at a sane number of tags", () => {
		const raw = Array.from({ length: 30 }, (_, i) => `tag-${i}`).join(",");
		expect(parseTags(raw)).toHaveLength(12);
	});
});

describe("the built-in catalog", () => {
	const all = [...BUILTIN_TEMPLATES, ...BUILTIN_TEMPLATES_APPS];

	test("gives every template tags, so search reaches all of them", () => {
		const untagged = all.filter((t) => t.tags.length === 0).map((t) => t.id);
		expect(untagged).toEqual([]);
	});

	test("keeps template ids unique", () => {
		expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
	});
});
