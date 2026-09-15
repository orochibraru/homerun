import { z } from "zod";

const optionalNumber = (schema: z.ZodNumber | z.ZodCoercedNumber) =>
	z.preprocess(
		(val) => (val === "" || val === undefined ? undefined : val),
		schema.optional(),
	);

export const createTemplateSchema = z.object({
	category: z.string().optional(),
	containerPort: z.coerce
		.number({ error: "Container port is required." })
		.int()
		.min(1)
		.max(65_535),
	cpuLimit: z.string().optional(),
	description: z.string().optional(),
	icon: z.string().optional(),
	image: z.string().min(1, "Image is required."),
	memoryLimitMb: optionalNumber(z.coerce.number().int().positive()),
	name: z.string().min(1, "Name is required.").max(100),
	restartPolicy: z
		.enum(["no", "always", "on-failure", "unless-stopped"])
		.default("unless-stopped"),
	tag: z.string().min(1).default("latest"),
	tags: z.string().optional(),
});

/** Turns the Tags field's comma-separated text into the stored `string[]` : lowercased, trimmed, de-duplicated, capped so one paste can't fill the column. */
export function parseTags(raw: string | undefined | null): string[] {
	if (!raw) {
		return [];
	}
	const seen = new Set<string>();
	for (const part of raw.split(",")) {
		const tag = part.trim().toLowerCase().slice(0, 30);
		if (tag) {
			seen.add(tag);
		}
	}
	return [...seen].slice(0, 12);
}

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
