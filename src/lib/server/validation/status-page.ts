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

export const notificationChannelSchema = z.object({
	enabled: z.coerce.boolean().default(true),
	kind: z.enum(["webhook", "email"]),
	name: z.string().trim().min(1, "Give the channel a name.").max(100),
	statusPageId: z.string().trim().optional().default(""),
	target: z.string().trim().min(1, "Give the channel a destination."),
});

export function validateChannelTarget(
	kind: "webhook" | "email",
	target: string,
): string | null {
	if (kind === "email") {
		return z.string().email().safeParse(target).success
			? null
			: "That doesn't look like an email address.";
	}
	let url: URL;
	try {
		url = new URL(target);
	} catch {
		return "That doesn't look like a URL.";
	}
	return url.protocol === "http:" || url.protocol === "https:"
		? null
		: "A webhook URL must start with http:// or https://.";
}
