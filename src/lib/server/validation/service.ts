import { z } from "zod";

// Optional numeric fields that come from a plain <input>: an empty field
// still submits as "" in FormData, and z.coerce.number() turns "" into 0
// (not NaN/undefined) — which then fails a .positive()/.min() check with
// no obvious cause. Treat "" as "not provided" before coercion.
const optionalNumber = (schema: z.ZodNumber) =>
	z.preprocess(
		(val) => (val === "" || val === undefined ? undefined : val),
		schema.optional(),
	);

export const createServiceSchema = z.object({
	name: z.string().min(1, "Name is required.").max(100),
	slug: z
		.string()
		.min(1, "Slug is required.")
		.regex(
			/^[a-z0-9-]{1,63}$/,
			"Lowercase letters, numbers, and hyphens only.",
		),
	image: z.string().min(1, "Image is required."),
	tag: z.string().min(1).default("latest"),
	registryUrl: z.string().optional(),
	registryUsername: z.string().optional(),
	registryPassword: z.string().optional(),
	containerPort: z.coerce
		.number({ error: "Container port is required." })
		.int()
		.min(1)
		.max(65_535),
	restartPolicy: z
		.enum(["no", "always", "on-failure", "unless-stopped"])
		.default("unless-stopped"),
	cpuLimit: z.string().optional(),
	memoryLimitMb: optionalNumber(z.coerce.number().int().positive()),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;

// Same shape as create — every field (including slug) can be edited after
// the fact. registryPassword is optional here too: blank means "leave the
// stored credential unchanged", not "clear it" (see settings +page.server.ts).
export const updateServiceSchema = createServiceSchema;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

/** Zips parallel envKey[]/envValue[] form fields into a record, dropping blank keys. */
export function parseEnvVars(formData: FormData): Record<string, string> {
	const keys = formData.getAll("envKey").map(String);
	const values = formData.getAll("envValue").map(String);
	const env: Record<string, string> = {};
	keys.forEach((key, i) => {
		const trimmed = key.trim();
		if (trimmed) env[trimmed] = values[i] ?? "";
	});
	return env;
}
