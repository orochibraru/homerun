import { z } from "zod";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const statusPageSchema = z.object({
	description: z.string().trim().max(500).optional().default(""),
	isPublic: z.coerce.boolean().default(false),
	name: z.string().trim().min(1, "Give the status page a name.").max(100),
	projectId: z.string().trim().optional().default(""),
	scope: z.enum(["global", "project", "custom"]),
	slug: z
		.string()
		.trim()
		.min(1, "Give the status page a URL slug.")
		.max(60)
		.regex(SLUG_RE, "Lowercase letters, numbers and dashes only."),
});
