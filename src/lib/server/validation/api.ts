import { z } from "zod";

/**
 * Request-body schemas for the JSON REST API (`src/routes/api/v1/**`) : kept
 * separate from `validation/service.ts`'s FormData-shaped schemas (checkbox/
 * `envKey[]`/`envValue[]` preprocessing that only makes sense for an HTML
 * form submission). These are also the single source of truth the OpenAPI
 * spec (`$lib/openapi/`) is generated from via `z.toJSONSchema()` : the same
 * schema instance validates a request *and* documents it, so the two can't
 * drift the way a hand-maintained spec would.
 */

const SLUG_RE = /^[a-z0-9-]{1,63}$/;

export const createServiceApiBody = z
	.object({
		authRequired: z.boolean().default(false),
		buildSource: z.enum(["image", "git"]).default("image"),
		containerPort: z.number().int().min(1).max(65_535),
		cpuLimit: z.string().optional(),
		dnsResolvable: z.boolean().default(true),
		envVars: z.record(z.string(), z.string()).default({}),
		gitBuildContext: z.string().optional(),
		gitDockerfilePath: z.string().optional(),
		gitRef: z.string().optional(),
		gitUrl: z.string().optional(),
		image: z.string().optional(),
		memoryLimitMb: z.number().int().positive().optional(),
		name: z.string().min(1).max(100),
		projectId: z.string().optional(),
		registryPassword: z.string().optional(),
		registryUrl: z.string().optional(),
		registryUsername: z.string().optional(),
		restartPolicy: z
			.enum(["no", "always", "on-failure", "unless-stopped"])
			.default("unless-stopped"),
		slug: z.string().regex(SLUG_RE),
		tag: z.string().min(1).optional(),
	})
	.refine((v) => v.buildSource !== "git" || !!v.gitUrl, {
		error: 'gitUrl is required when buildSource is "git".',
		path: ["gitUrl"],
	})
	.refine((v) => v.buildSource === "git" || !!v.image, {
		error: 'image is required when buildSource is "image".',
		path: ["image"],
	});

/** The validated JSON body of `POST /api/v1/services`. */
export type CreateServiceApiInput = z.infer<typeof createServiceApiBody>;

export const updateServiceApiBody = z.object({
	authRequired: z.boolean().optional(),
	buildSource: z.enum(["image", "git"]).optional(),
	containerPort: z.number().int().min(1).max(65_535).optional(),
	cpuLimit: z.string().nullable().optional(),
	customDomain: z.string().nullable().optional(),
	dnsResolvable: z.boolean().optional(),
	envVars: z.record(z.string(), z.string()).optional(),
	gitBuildContext: z.string().nullable().optional(),
	gitDockerfilePath: z.string().nullable().optional(),
	gitRef: z.string().nullable().optional(),
	gitUrl: z.string().nullable().optional(),
	image: z.string().min(1).optional(),
	memoryLimitMb: z.number().int().positive().nullable().optional(),
	name: z.string().min(1).max(100).optional(),
	registryPassword: z.string().optional(),
	registryUrl: z.string().nullable().optional(),
	registryUsername: z.string().nullable().optional(),
	remoteHostId: z.string().nullable().optional(),
	restartPolicy: z
		.enum(["no", "always", "on-failure", "unless-stopped"])
		.optional(),
	tag: z.string().min(1).optional(),
});

export const createProjectApiBody = z.object({
	description: z.string().optional(),
	name: z.string().min(1).max(100),
	slug: z.string().regex(SLUG_RE),
});
