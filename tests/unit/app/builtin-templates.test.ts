import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	TEMPLATE_CATEGORY_COLORS,
	TEMPLATE_CATEGORY_ICONS,
} from "../../../src/lib/constants";
import {
	BUILTIN_TEMPLATE_CATEGORIES,
	parseBuiltinTemplates,
} from "../../../src/lib/server/db/builtin-templates";
import { templateCategoryLabel } from "../../../src/lib/template-categories";

const root = join(import.meta.dir, "../../..");

async function readTemplateFiles(): Promise<Record<string, unknown>> {
	const files: Record<string, unknown> = {};
	for await (const name of new Bun.Glob("*/*.json").scan(
		join(root, "templates"),
	)) {
		files[`/templates/${name}`] = await Bun.file(
			join(root, "templates", name),
		).json();
	}
	return files;
}

const leaf = {
	containerPort: 5432,
	description: "db",
	envVars: {},
	icon: "",
	image: "postgres",
	name: "PostgreSQL",
	sourceUrl: null,
	tag: "18",
	tags: ["sql"],
	websiteUrl: null,
};

describe("templates/*.json", () => {
	test("every file is a valid template and every link resolves", async () => {
		const { templates, links } = parseBuiltinTemplates(
			await readTemplateFiles(),
		);
		expect(templates.length).toBeGreaterThan(0);
		expect(links.length).toBeGreaterThan(0);
	});

	test("every bundled icon exists under static/template-icons", async () => {
		const { templates } = parseBuiltinTemplates(await readTemplateFiles());
		const missing = templates
			.filter(
				(t) =>
					t.icon && !existsSync(join(root, "static/template-icons", t.icon)),
			)
			.map((t) => `${t.id}: ${t.icon}`);
		expect(missing).toEqual([]);
	});

	test("every category but other has its own icon and colour", () => {
		const iconless = BUILTIN_TEMPLATE_CATEGORIES.filter(
			(c) =>
				c !== "other" &&
				!(TEMPLATE_CATEGORY_ICONS[c] && TEMPLATE_CATEGORY_COLORS[c]),
		);
		expect(iconless).toEqual([]);
	});
});

describe("parseBuiltinTemplates", () => {
	test("derives ids from file names", () => {
		const { templates, links } = parseBuiltinTemplates({
			"/templates/other/app.json": {
				...leaf,
				links: [{ alias: "db", template: "postgres" }],
				name: "App",
			},
			"/templates/database/postgres.json": leaf,
		});
		expect(templates.map((t) => t.id).sort()).toEqual([
			"builtin-app",
			"builtin-postgres",
		]);
		expect(links).toEqual([
			{
				alias: "db",
				id: "builtin-link-app-db",
				linkedTemplateId: "builtin-postgres",
				templateId: "builtin-app",
			},
		]);
	});

	test("takes the category from the folder, and rejects an unknown one", () => {
		const { templates } = parseBuiltinTemplates({
			"/templates/database/postgres.json": leaf,
		});
		expect(templates[0].category).toBe("database");
		expect(() =>
			parseBuiltinTemplates({ "/templates/databse/postgres.json": leaf }),
		).toThrow(/databse/);
	});

	test("rejects the same slug in two folders", () => {
		expect(() =>
			parseBuiltinTemplates({
				"/templates/cache/redis.json": leaf,
				"/templates/database/redis.json": leaf,
			}),
		).toThrow(/unique/);
	});

	test("names the file and field of an invalid template", () => {
		expect(() =>
			parseBuiltinTemplates({
				"/templates/other/bad.json": { ...leaf, containerPort: 0 },
			}),
		).toThrow(/bad\.json[\s\S]*containerPort/);
	});

	test("rejects unknown fields, so a typo doesn't silently vanish", () => {
		expect(() =>
			parseBuiltinTemplates({
				"/templates/other/bad.json": { ...leaf, envVar: {} },
			}),
		).toThrow(/bad\.json/);
	});

	test("rejects a link to a missing or non-leaf template", () => {
		expect(() =>
			parseBuiltinTemplates({
				"/templates/other/app.json": {
					...leaf,
					links: [{ alias: "db", template: "nope" }],
				},
			}),
		).toThrow(/nope/);
		expect(() =>
			parseBuiltinTemplates({
				"/templates/other/a.json": {
					...leaf,
					links: [{ alias: "b", template: "b" }],
				},
				"/templates/other/b.json": {
					...leaf,
					links: [{ alias: "c", template: "c" }],
				},
				"/templates/other/c.json": leaf,
			}),
		).toThrow(/only leaf templates/);
	});
});

describe("templateCategoryLabel", () => {
	test("labels a known category and passes an unknown one through", () => {
		expect(templateCategoryLabel("ai")).toBe("AI");
		expect(templateCategoryLabel("cms")).toBe("CMS");
		expect(templateCategoryLabel("custom-thing")).toBe("custom-thing");
	});
});
