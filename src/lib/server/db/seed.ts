import { inArray, sql } from "drizzle-orm";
import {
	BUILTIN_TEMPLATE_LINKS,
	BUILTIN_TEMPLATES,
} from "$lib/server/db/builtin-templates";
import { BUILTIN_TEMPLATES_APPS } from "$lib/server/db/builtin-templates-apps";
import { db } from "$lib/server/db/lib";
import { template, templateLink } from "$lib/server/db/schema";
import { runtimeOptionsFrom } from "$lib/service-runtime";

const RETIRED_BUILTIN_IDS = ["builtin-newt"];

/**
 * Upserts every built-in template, overwriting their stored fields with the
 * current definitions, then inserts any built-in template links not already
 * present, and deletes built-in templates that no longer exist. Safe to run on
 * every boot.
 */
export async function seedBuiltinTemplates(): Promise<void> {
	const now = new Date();
	await db.delete(template).where(inArray(template.id, RETIRED_BUILTIN_IDS));
	await db
		.insert(template)
		.values(
			[...BUILTIN_TEMPLATES, ...BUILTIN_TEMPLATES_APPS].map((t) => ({
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

	await db
		.insert(templateLink)
		.values(BUILTIN_TEMPLATE_LINKS.map((l) => ({ ...l, createdAt: now })))
		.onConflictDoNothing();
}
