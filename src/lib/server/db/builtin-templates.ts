import { z } from "zod";
import type { ServiceRuntimeOptions } from "$lib/service-runtime";
import {
	TEMPLATE_CATEGORIES,
	type TemplateCategory,
} from "$lib/template-categories";

export interface BuiltinTemplate extends Partial<ServiceRuntimeOptions> {
	category: string;
	containerPort: number;
	description: string;
	envVars: Record<string, string>;
	healthcheckCommand?: string;
	icon: string;
	id: string;
	image: string;
	name: string;
	sourceUrl: string | null;
	tag: string;
	tags: string[];
	websiteUrl: string | null;
}

export interface BuiltinTemplateLink {
	alias: string;
	id: string;
	linkedTemplateId: string;
	templateId: string;
}

export const BUILTIN_TEMPLATE_CATEGORIES: readonly TemplateCategory[] =
	TEMPLATE_CATEGORIES.map((c) => c.value);

const argv = z.array(z.string()).nullable();

export const builtinTemplateFileSchema = z
	.strictObject({
		$schema: z.string().optional(),
		capAdd: z.array(z.string()).optional(),
		command: argv.optional(),
		containerPort: z.number().int().min(1).max(65_535),
		description: z.string().min(1),
		devices: z.array(z.string()).optional(),
		entrypoint: argv.optional(),
		envFiles: z.array(z.string()).optional(),
		envVars: z.record(z.string(), z.string()),
		healthcheckCommand: z.string().optional(),
		icon: z
			.string()
			.describe(
				"di:<name> for a Dashboard Icons (dashboardicons.com) icon, a file name under static/template-icons/, or an empty string for the category's generic icon.",
			),
		image: z.string().min(1),
		labels: z.record(z.string(), z.string()).optional(),
		links: z
			.array(
				z.strictObject({
					alias: z
						.string()
						.regex(/^[a-z0-9_-]+$/)
						.describe(
							"Name the env vars use to reference the linked service: {{alias}}, {{alias.VAR}}.",
						),
					template: z
						.string()
						.describe(
							"File name (without .json) of the linked template, which must have no links itself.",
						),
				}),
			)
			.optional(),
		name: z.string().min(1).max(100),
		privileged: z.boolean().optional(),
		sourceUrl: z.url().nullable(),
		tag: z.string().min(1),
		tags: z.array(z.string().min(1).max(30)).min(1).max(12),
		websiteUrl: z.url().nullable(),
	})
	.describe(
		"A Homerun built-in template: templates/<category>/<slug>.json, where the folder is its category.",
	);

/** Splits a `templates/<category>/<slug>.json` path into its category and slug. */
function locate(path: string): { category: string; slug: string } {
	const [slug = "", category = ""] = path.split("/").reverse();
	return { category, slug: slug.replace(/\.json$/, "") };
}

/**
 * Validates every `templates/<category>/<slug>.json` file and turns them into
 * the rows the seeder writes: the folder is the category, each template's id
 * is `builtin-<slug>`, each link's id is
 * `builtin-link-<slug>-<alias>`.
 *
 * @param files Parsed JSON contents keyed by file path.
 * @throws Error naming the file and field when a template is invalid, sits in
 *   a folder that isn't a known category, reuses another folder's slug, a link
 *   points at a missing template or at one that has links of its own, or a
 *   template reuses an alias.
 */
export function parseBuiltinTemplates(files: Record<string, unknown>): {
	links: BuiltinTemplateLink[];
	templates: BuiltinTemplate[];
} {
	const parsed = new Map<
		string,
		z.infer<typeof builtinTemplateFileSchema> & { category: string }
	>();
	const categories: readonly string[] = BUILTIN_TEMPLATE_CATEGORIES;
	for (const [path, content] of Object.entries(files)) {
		const { category, slug } = locate(path);
		if (!categories.includes(category)) {
			throw new Error(
				`Template ${path} is in "${category}/", which isn't a category (${categories.join(", ")}).`,
			);
		}
		if (parsed.has(slug)) {
			throw new Error(
				`Template ${path} reuses the slug "${slug}" : file names must be unique across every category folder.`,
			);
		}
		const result = builtinTemplateFileSchema.safeParse(content);
		if (!result.success) {
			throw new Error(
				`Invalid template ${path}: ${z.prettifyError(result.error)}`,
			);
		}
		parsed.set(slug, { ...result.data, category });
	}

	const templates: BuiltinTemplate[] = [];
	const links: BuiltinTemplateLink[] = [];
	for (const [slug, file] of parsed) {
		const { $schema: _schema, links: fileLinks = [], ...template } = file;
		templates.push({ ...template, id: `builtin-${slug}` });
		const aliases = new Set<string>();
		for (const link of fileLinks) {
			const target = parsed.get(link.template);
			if (!target) {
				throw new Error(
					`Template ${slug} links to "${link.template}", which has no templates/<category>/${link.template}.json.`,
				);
			}
			if (target.links?.length) {
				throw new Error(
					`Template ${slug} links to "${link.template}", which has links of its own : only leaf templates can be linked.`,
				);
			}
			if (aliases.has(link.alias)) {
				throw new Error(
					`Template ${slug} uses the alias "${link.alias}" twice.`,
				);
			}
			aliases.add(link.alias);
			links.push({
				alias: link.alias,
				id: `builtin-link-${slug}-${link.alias}`,
				linkedTemplateId: `builtin-${link.template}`,
				templateId: `builtin-${slug}`,
			});
		}
	}
	return { links, templates };
}
