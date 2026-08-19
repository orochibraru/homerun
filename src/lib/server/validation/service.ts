import { z } from "zod";

// Optional numeric fields that come from a plain <input>: an empty field
// still submits as "" in FormData, and z.coerce.number() turns "" into 0
// (not NaN/undefined) — which then fails a .positive()/.min() check with
// no obvious cause. Treat "" as "not provided" before coercion.
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (val) => (val === "" || val === undefined ? undefined : val),
    schema.optional()
  );

const baseServiceSchema = z.object({
  // Checkbox convention (also used below): present ("on") when checked,
  // absent from FormData entirely when unchecked — never a literal
  // "false" to coerce.
  authRequired: z.preprocess(
    (val) => val === "on" || val === true,
    z.boolean()
  ),
  // "image" (bring-your-own, the default) | "git" (clone + build a
  // Dockerfile) — cross-checked against the other git*/image fields below,
  // since which of those is required depends on this.
  buildSource: z.enum(["image", "git"]).default("image"),
  containerPort: z.coerce
    .number({ error: "Container port is required." })
    .int()
    .min(1)
    .max(65_535),
  cpuLimit: z.string().optional(),
  dnsResolvable: z.preprocess(
    (val) => val === "on" || val === true,
    z.boolean()
  ),
  gitBuildContext: z.string().optional(),
  gitDockerfilePath: z.string().optional(),
  gitRef: z.string().optional(),
  gitUrl: z.string().optional(),
  image: z.string().optional(),
  memoryLimitMb: optionalNumber(z.coerce.number().int().positive()),
  name: z.string().min(1, "Name is required.").max(100),
  registryPassword: z.string().optional(),
  registryUrl: z.string().optional(),
  registryUsername: z.string().optional(),
  restartPolicy: z
    .enum(["no", "always", "on-failure", "unless-stopped"])
    .default("unless-stopped"),
  slug: z
    .string()
    .min(1, "Slug is required.")
    .regex(
      /^[a-z0-9-]{1,63}$/,
      "Lowercase letters, numbers, and hyphens only."
    ),
  tag: z.string().optional(),
});

export const createServiceSchema = baseServiceSchema.superRefine(
  (input, ctx) => {
    if (input.buildSource === "git") {
      if (!input.gitUrl) {
        ctx.addIssue({
          code: "custom",
          message: "Git repository URL is required.",
          path: ["gitUrl"],
        });
      }
      return;
    }
    if (!input.image) {
      ctx.addIssue({
        code: "custom",
        message: "Image is required.",
        path: ["image"],
      });
    }
  }
);

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
    if (trimmed) {
      env[trimmed] = values[i] ?? "";
    }
  });
  return env;
}
