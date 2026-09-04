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
				ownerId: null,
				restartPolicy: "unless-stopped" as const,
				updatedAt: now,
			})),
		)
		.onConflictDoNothing();

	await db
		.insert(templateLink)
		.values(BUILTIN_TEMPLATE_LINKS.map((l) => ({ ...l, createdAt: now })))
		.onConflictDoNothing();
}
