import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	TEMPLATE_CATEGORY_COLORS,
	TEMPLATE_CATEGORY_ICONS,
} from "../../../src/lib/constants";
import { EXTRA_ICONS } from "../../../src/lib/icon-library";
import {
	BUILTIN_TEMPLATE_CATEGORIES,
	parseBuiltinTemplates,
} from "../../../src/lib/server/db/builtin-templates";
import { iconProblem } from "../../../src/lib/service-icon";
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

	test("every icon is a valid Dashboard Icon or exists under static/template-icons", async () => {
		const { templates } = parseBuiltinTemplates(await readTemplateFiles());
		const missing = templates
			.filter(
				(t) =>
					t.icon &&
					(t.icon.startsWith("di:")
						? iconProblem(t.icon, []) !== null
						: !existsSync(join(root, "static/template-icons", t.icon))),
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

	test("rejects a secret token it can't fill", () => {
		expect(() =>
			parseBuiltinTemplates({
				"/templates/database/postgres.json": {
					...leaf,
					envVars: { KEY: "{{secret:base64}}" },
				},
			}),
		).toThrow(/secret token/);
		expect(() =>
			parseBuiltinTemplates({
				"/templates/database/postgres.json": {
					...leaf,
					command: ["run", "{{secret:hex0}}"],
				},
			}),
		).toThrow(/secret token/);
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

	test("carries published ports through, and rejects a reused or Traefik host port", () => {
		const ssh = { containerPort: 22, hostPort: 2222, protocol: "tcp" as const };
		const { templates } = parseBuiltinTemplates({
			"/templates/other/forge.json": { ...leaf, publishedPorts: [ssh] },
		});
		expect(templates[0]?.publishedPorts).toEqual([ssh]);
		expect(() =>
			parseBuiltinTemplates({
				"/templates/other/bad.json": {
					...leaf,
					publishedPorts: [ssh, { ...ssh, containerPort: 23 }],
				},
			}),
		).toThrow(/bad\.json[\s\S]*publishedPorts/);
		expect(() =>
			parseBuiltinTemplates({
				"/templates/other/bad.json": {
					...leaf,
					publishedPorts: [{ ...ssh, hostPort: 443 }],
				},
			}),
		).toThrow(/bad\.json[\s\S]*publishedPorts/);
	});

	test("the built-in forges publish their SSH port", async () => {
		const { templates } = parseBuiltinTemplates(await readTemplateFiles());
		const forges = templates.filter((t) =>
			["builtin-gitea", "builtin-forgejo"].includes(t.id),
		);
		expect(forges).toHaveLength(2);
		for (const forge of forges) {
			expect(forge.publishedPorts?.map((p) => p.containerPort)).toEqual([22]);
		}
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

describe("EXTRA_ICONS", () => {
	test("every library icon is a Dashboard Icon or exists under static/template-icons, once", () => {
		const missing = EXTRA_ICONS.filter((entry) =>
			entry.icon.startsWith("di:")
				? iconProblem(entry.icon, []) !== null
				: !existsSync(join(root, "static/template-icons", entry.icon)),
		).map((entry) => entry.icon);
		expect(missing).toEqual([]);
		expect(new Set(EXTRA_ICONS.map((entry) => entry.icon)).size).toBe(
			EXTRA_ICONS.length,
		);
	});
});
