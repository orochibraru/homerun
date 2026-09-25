import { and, inArray, like, notInArray, sql } from "drizzle-orm";
import { parseBuiltinTemplates } from "$lib/server/db/builtin-templates";
import { db } from "$lib/server/db/lib";
import { template, templateLink } from "$lib/server/db/schema";
import { runtimeOptionsFrom } from "$lib/service-runtime";

const RETIRED_BUILTIN_IDS = ["builtin-newt"];

const TEMPLATE_FILES = import.meta.glob("/templates/*/*.json", {
	eager: true,
	import: "default",
});

/**
 * Upserts every built-in template from `templates/<category>/*.json`, overwriting their
 * stored fields with the current definitions, replaces the built-in template
 * links with the ones those files declare, and deletes retired built-in
 * templates. Safe to run on every boot.
 *
 * @throws Error when a template file is invalid (see `parseBuiltinTemplates`).
 */
export async function seedBuiltinTemplates(): Promise<void> {
	const now = new Date();
	const { links, templates } = parseBuiltinTemplates(TEMPLATE_FILES);
	await db.delete(template).where(inArray(template.id, RETIRED_BUILTIN_IDS));
	await db
		.insert(template)
		.values(
			templates.map((t) => ({
				...t,
				...runtimeOptionsFrom(t),
				createdAt: now,
				healthcheckCommand: t.healthcheckCommand ?? null,
				ownerId: null,
				restartPolicy: "unless-stopped" as const,
				updatedAt: now,
			})),
		)
		.onConflictDoUpdate({
			set: {
				capAdd: sql`excluded.cap_add`,
				category: sql`excluded.category`,
				command: sql`excluded.command`,
				containerPort: sql`excluded.container_port`,
				description: sql`excluded.description`,
				devices: sql`excluded.devices`,
				entrypoint: sql`excluded.entrypoint`,
				envFiles: sql`excluded.env_files`,
				envVars: sql`excluded.env_vars`,
				healthcheckCommand: sql`excluded.healthcheck_command`,
				icon: sql`excluded.icon`,
				image: sql`excluded.image`,
				labels: sql`excluded.labels`,
				name: sql`excluded.name`,
				privileged: sql`excluded.privileged`,
				sourceUrl: sql`excluded.source_url`,
				tag: sql`excluded.tag`,
				tags: sql`excluded.tags`,
				updatedAt: now,
				websiteUrl: sql`excluded.website_url`,
			},
			target: template.id,
		});

	await db.delete(templateLink).where(
		and(
			like(templateLink.id, "builtin-link-%"),
			notInArray(
				templateLink.id,
				links.map((l) => l.id),
			),
		),
	);
	await db
		.insert(templateLink)
		.values(links.map((l) => ({ ...l, createdAt: now })))
		.onConflictDoUpdate({
			set: {
				alias: sql`excluded.alias`,
				linkedTemplateId: sql`excluded.linked_template_id`,
			},
			target: templateLink.id,
		});
}
