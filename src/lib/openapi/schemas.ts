import { z } from "zod";

/**
 * Response-shape schemas for the OpenAPI spec. Request bodies are generated
 * straight from `$lib/server/validation/api.ts`'s real validation schemas
 * (single source of truth, zero drift risk); these response schemas are
 * hand-mirrored from `src/lib/server/db/schema.ts`'s columns instead,
 * because every route's response is a DTO's `.toJSON()` : the raw DB row,
 * not something already validated by a zod schema at runtime. Keep these in
 * sync by hand if the schema changes; there's no single source of truth for
 * the response side the way there is for requests.
 */

const isoTimestamp = z.string().meta({
	description: "ISO 8601 timestamp",
	example: "2026-08-20T12:00:00.000Z",
});

export const errorResponse = z.object({
	error: z.string(),
	issues: z.unknown().optional(),
});

export const serviceResponse = z.object({
	authRequired: z.boolean(),
	autoscaleEligible: z.boolean(),
	buildSource: z.enum(["image", "git"]),
	containerId: z.string().nullable(),
	containerPort: z.number().int(),
	cpuLimit: z.string().nullable(),
	createdAt: isoTimestamp,
	cronEnabled: z.boolean(),
	cronLastRunAt: isoTimestamp.nullable(),
	cronSchedule: z.string().nullable(),
	currentStatus: z.enum([
		"pending",
		"pulling",
		"starting",
		"running",
		"stopped",
		"failed",
	]),
	customDomain: z.string().nullable(),
	// Ciphertext (AES-256-GCM), not plaintext : present because `.toJSON()`
	// returns the raw row as-is. Documented honestly rather than hidden, since
	// hiding it here would make the spec describe a smaller response than the
	// API actually returns.
	customSslCertEnc: z.string().nullable(),
	customSslKeyEnc: z.string().nullable(),
	desiredState: z.enum(["running", "stopped"]),
	dnsResolvable: z.boolean(),
	envVars: z.record(z.string(), z.string()),
	gitBuildContext: z.string().nullable(),
	gitDockerfilePath: z.string().nullable(),
	gitRef: z.string().nullable(),
	gitUrl: z.string().nullable(),
	id: z.string(),
	image: z.string(),
	memoryLimitMb: z.number().int().nullable(),
	name: z.string(),
	networkMode: z.enum(["bridge", "host"]),
	portProtocol: z.enum(["tcp", "udp", "both"]),
	projectId: z.string().nullable(),
	registryPasswordEnc: z
		.string()
		.nullable()
		.meta({ description: "Ciphertext, not plaintext." }),
	registryUrl: z.string().nullable(),
	registryUsername: z.string().nullable(),
	remoteHostId: z.string().nullable(),
	restartPolicy: z.enum(["no", "always", "on-failure", "unless-stopped"]),
	slug: z.string(),
	tag: z.string(),
	updatedAt: isoTimestamp,
	userId: z.string(),
});

export const projectResponse = z.object({
	createdAt: isoTimestamp,
	description: z.string().nullable(),
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	updatedAt: isoTimestamp,
	userId: z.string(),
});

export const templateResponse = z.object({
	category: z.string().nullable(),
	containerPort: z.number().int(),
	cpuLimit: z.string().nullable(),
	createdAt: isoTimestamp,
	description: z.string().nullable(),
	envVars: z.record(z.string(), z.string()).nullable(),
	icon: z.string().nullable(),
	id: z.string(),
	image: z.string(),
	memoryLimitMb: z.number().int().nullable(),
	name: z.string(),
	ownerId: z
		.string()
		.nullable()
		.meta({ description: "null = built-in template" }),
	restartPolicy: z.string(),
	tag: z.string(),
	updatedAt: isoTimestamp,
});

export const deployResultResponse = z.object({
	containerId: z.string().optional(),
	deploymentId: z.string(),
	error: z.string().optional(),
	success: z.boolean(),
});

export const okResponse = z.object({ ok: z.boolean() });

export const successResponse = z.object({ success: z.boolean() });

export const systemStatsResponse = z.object({
	cpuPercent: z.number(),
	diskPercent: z.number().nullable(),
	diskTotalMb: z.number().nullable(),
	diskUsedMb: z.number().nullable(),
	gpu: z
		.object({
			memTotalMb: z.number(),
			memUsedMb: z.number(),
			name: z.string(),
			utilizationPercent: z.number(),
		})
		.nullable(),
	memPercent: z.number(),
	memTotalMb: z.number(),
	memUsedMb: z.number(),
});
