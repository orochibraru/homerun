import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { createTemplateSchema, parseTags } = await import(
	"../../../src/lib/server/validation/template"
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

describe("createTemplateSchema", () => {
	const base = { containerPort: "8080", image: "nginx", name: "Nginx" };

	test("coerces the port and fills in defaults", () => {
		const parsed = createTemplateSchema.parse(base);
		expect(parsed.containerPort).toBe(8080);
		expect(parsed.tag).toBe("latest");
		expect(parsed.restartPolicy).toBe("unless-stopped");
		expect(parsed.memoryLimitMb).toBeUndefined();
	});

	test("treats an empty memory limit as unset and coerces a filled one", () => {
		expect(
			createTemplateSchema.parse({ ...base, memoryLimitMb: "" }).memoryLimitMb,
		).toBeUndefined();
		expect(
			createTemplateSchema.parse({ ...base, memoryLimitMb: "512" })
				.memoryLimitMb,
		).toBe(512);
	});

	test("rejects a non-positive memory limit and a missing image", () => {
		expect(
			createTemplateSchema.safeParse({ ...base, memoryLimitMb: "-1" }).success,
		).toBe(false);
		expect(createTemplateSchema.safeParse({ ...base, image: "" }).success).toBe(
			false,
		);
	});
});
