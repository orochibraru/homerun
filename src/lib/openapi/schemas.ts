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
	authAllowedEmails: z.array(z.string()),
	authAllowedGroups: z.array(z.string()),
	authAllowedUserIds: z.array(z.string()),
	authProviders: z.array(z.string()),
	authRequired: z.boolean(),
	autoRollback: z.boolean().meta({
		description:
			"Redeploy the previous healthy revision when a new one is unhealthy",
	}),
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
		"missing",
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
	autoDeployOnPush: z.boolean(),
	gitBuildContext: z.string().nullable(),
	gitDockerfilePath: z.string().nullable(),
	gitProviderId: z.string().nullable(),
	gitRef: z.string().nullable(),
	gitRepo: z.string().nullable(),
	gitUrl: z.string().nullable(),
	gitWebhookError: z.string().nullable(),
	gitWebhookId: z.string().nullable(),
	gitWebhookSecretEnc: z.string().nullable(),
	healthcheckCommand: z.string().nullable(),
	id: z.string(),
	image: z.string(),
	imageScanEnabled: z.boolean(),
	memoryLimitMb: z.number().int().nullable(),
	name: z.string(),
	networkMode: z.enum(["bridge", "host"]),
	portProtocol: z.enum(["tcp", "udp", "both"]),
	stackId: z.string().nullable(),
	registryPasswordEnc: z
		.string()
		.nullable()
		.meta({ description: "Ciphertext, not plaintext." }),
	registryUrl: z.string().nullable(),
	registryUsername: z.string().nullable(),
	requireStatusChecks: z.boolean().meta({
		description:
			"Git builds only: every check in requiredStatusChecks must pass on the commit before it's built",
	}),
	requiredStatusChecks: z.array(z.string()),
	restartPolicy: z.enum(["no", "always", "on-failure", "unless-stopped"]),
	slug: z.string(),
	tag: z.string(),
	updatedAt: isoTimestamp,
	userId: z.string(),
});

export const stackResponse = z.object({
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

export const revisionResponse = z.object({
	buildSource: z.enum(["image", "git"]).nullable(),
	createdAt: isoTimestamp,
	current: z.boolean().meta({ description: "The revision running now" }),
	finishedAt: isoTimestamp.nullable(),
	gitCommit: z.string().nullable(),
	gitRef: z.string().nullable(),
	health: z
		.enum(["watching", "healthy", "unhealthy", "rolled_back"])
		.nullable()
		.meta({ description: "null = recorded before health watching existed" }),
	id: z.string(),
	imageDigest: z.string().nullable(),
	imageId: z.string().nullable(),
	imageRef: z.string().nullable(),
	previous: z.boolean().meta({
		description:
			"The default rollback target: the newest older healthy revision with a different image",
	}),
	retained: z.boolean().meta({
		description:
			"Among the last 5 distinct images kept on the host and in the mirror",
	}),
	rollbackOfDeploymentId: z
		.string()
		.nullable()
		.meta({ description: "Set when this revision redeployed an older one" }),
	status: z.enum([
		"pending",
		"pulling",
		"starting",
		"running",
		"stopped",
		"failed",
		"missing",
	]),
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

const severityCounts = z.object({
	critical: z.number().int(),
	high: z.number().int(),
	low: z.number().int(),
	medium: z.number().int(),
	unknown: z.number().int(),
});

export const imageScanSummaryResponse = z.object({
	counts: severityCounts,
	deploymentId: z
		.string()
		.nullable()
		.meta({ description: "null = scanned on demand, not during a deploy" }),
	digest: z.string().nullable(),
	error: z
		.string()
		.nullable()
		.meta({ description: "Why a failed or skipped scan has no findings" }),
	id: z.string(),
	imageRef: z.string(),
	scannedAt: isoTimestamp,
	serviceId: z.string(),
	source: z.string(),
	status: z.enum(["ok", "failed", "skipped"]),
	totalFindings: z.number().int().meta({
		description:
			"Every unique finding, including those beyond the stored findings cap",
	}),
});

export const imageScanResponse = imageScanSummaryResponse.extend({
	findings: z
		.array(
			z.object({
				fixedVersion: z.string().nullable(),
				id: z.string(),
				installedVersion: z.string(),
				pkg: z.string(),
				severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
				title: z.string().nullable(),
			}),
		)
		.meta({
			description:
				"Sorted most severe first, capped at 200 : totalFindings has the real count",
		}),
});

export const queuedJobResponse = z.object({
	jobId: z.string(),
	status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
});

export const pushWebhookResponse = z.object({
	error: z.string().nullable().meta({
		description:
			"Why Homerun couldn't register the webhook itself, if it couldn't",
	}),
	providerName: z.string().nullable(),
	registered: z.boolean().meta({
		description: "Whether Homerun registered the webhook on the provider",
	}),
	secret: z
		.string()
		.meta({ description: "The secret deliveries are signed with" }),
	url: z.string().nullable().meta({
		description: "Where the provider should send push events",
	}),
});

export const scanConflictResponse = z.object({
	error: z.string(),
	jobId: z.string().meta({ description: "The scan job already in flight" }),
});

export const jobResponse = z.object({
	createdAt: isoTimestamp,
	error: z.string().nullable(),
	finishedAt: isoTimestamp.nullable(),
	id: z.string(),
	result: z.record(z.string(), z.unknown()).nullable(),
	serviceId: z.string().nullable(),
	startedAt: isoTimestamp.nullable(),
	status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
	title: z.string(),
	type: z.string(),
});
