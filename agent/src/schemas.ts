import { z } from "zod";

/**
 * Single source of truth for both request validation and the OpenAPI spec
 * (`openapi.ts`) — same "one zod schema drives both" approach as the main
 * app's `$lib/server/validation/api.ts` / `$lib/openapi/`. Previously
 * `/v1/deploy`'s body was just `as DeployInput` — an unchecked cast, not
 * real validation; a malformed request would fail deep inside dockerode
 * with a confusing error instead of a clean 400. Fixed by actually parsing
 * against this schema in `http.ts`.
 */
export const envVarSchema = z.object({
	key: z.string().min(1),
	value: z.string(),
});

export const deployInputSchema = z.object({
	containerPort: z.number().int().min(1).max(65_535).nullable(),
	cpuLimit: z.number().positive().nullable(),
	envVars: z.array(envVarSchema).default([]),
	image: z.string().min(1),
	memoryLimitMb: z.number().int().positive().nullable(),
	networkMode: z.enum(["bridge", "host"]),
	portProtocol: z.enum(["tcp", "udp", "both"]),
	registryAuth: z
		.object({
			password: z.string(),
			serveraddress: z.string().optional(),
			username: z.string(),
		})
		.nullable()
		.optional(),
	restartPolicy: z.enum(["no", "always", "on-failure", "unless-stopped"]),
	serviceId: z.string().min(1),
	slug: z.string().min(1),
	tag: z.string().min(1),
});

export type DeployInput = z.infer<typeof deployInputSchema>;
