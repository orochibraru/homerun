import { sql } from "drizzle-orm";
import {
	BUILTIN_TEMPLATE_LINKS,
	BUILTIN_TEMPLATES,
} from "$lib/server/db/builtin-templates";
import { BUILTIN_TEMPLATES_APPS } from "$lib/server/db/builtin-templates-apps";
import { db } from "$lib/server/db/lib";
import { template, templateLink } from "$lib/server/db/schema";

export async function seedBuiltinTemplates(): Promise<void> {
	const now = new Date();
	await db
		.insert(template)
		.values(
			[...BUILTIN_TEMPLATES, ...BUILTIN_TEMPLATES_APPS].map((t) => ({
				...t,
				createdAt: now,
				healthcheckCommand: t.healthcheckCommand ?? null,
				ownerId: null,
				restartPolicy: "unless-stopped" as const,
				updatedAt: now,
			})),
		)
		.onConflictDoUpdate({
			set: {
				category: sql`excluded.category`,
				containerPort: sql`excluded.container_port`,
				description: sql`excluded.description`,
				envVars: sql`excluded.env_vars`,
				healthcheckCommand: sql`excluded.healthcheck_command`,
				icon: sql`excluded.icon`,
				image: sql`excluded.image`,
				name: sql`excluded.name`,
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
