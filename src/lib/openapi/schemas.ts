import { z } from "zod";
import { BUILD_METHODS } from "$lib/build-methods";
import { UPDATE_CHANNELS } from "$lib/update-channel";

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
	capAdd: z.array(z.string()),
	command: z.array(z.string()).nullable(),
	devices: z.array(z.string()),
	entrypoint: z.array(z.string()).nullable(),
	envFiles: z.array(z.string()),
	labels: z.record(z.string(), z.string()),
	privileged: z.boolean(),
	// Ciphertext (AES-256-GCM), not plaintext : present because `.toJSON()`
	// returns the raw row as-is. Documented honestly rather than hidden, since
	// hiding it here would make the spec describe a smaller response than the
	// API actually returns.
	customSslCertEnc: z.string().nullable(),
	customSslKeyEnc: z.string().nullable(),
	defaultDomainEnabled: z.boolean(),
	desiredState: z.enum(["running", "stopped"]),
	dnsResolvable: z.boolean(),
	domains: z.array(z.string()),
	envVars: z.record(z.string(), z.string()),
	secretEnvKeys: z.array(z.string()),
	autoDeployOnPush: z.boolean(),
	gitBakeFile: z.string().nullable(),
	primaryDomain: z.string().nullable(),
	gitBuildTarget: z.string().nullable(),
	gitBuildContext: z.string().nullable(),
	gitBuildMethod: z.enum(BUILD_METHODS),
	gitDockerfilePath: z.string().nullable(),
	gitProviderId: z.string().nullable(),
	gitRef: z.string().nullable(),
	gitRepo: z.string().nullable(),
	gitUrl: z.string().nullable(),
	gitWebhookError: z.string().nullable(),
	gitWebhookId: z.string().nullable(),
	gitWebhookSecretEnc: z.string().nullable(),
	gitWebhookReconnect: z.boolean(),
	gitPollEnabled: z.boolean(),
	gitLastSeenCommit: z.string().nullable(),
	previewDefaultDomain: z.boolean(),
	previewDomainTemplate: z.string().nullable(),
	previewsEnabled: z.boolean(),
	previewParentId: z.string().nullable(),
	previewPrNumber: z.number().int().nullable(),
	previewPrTitle: z.string().nullable(),
	previewBranch: z.string().nullable(),
	healthcheckCommand: z.string().nullable(),
	healthcheckDisabled: z.boolean(),
	healthcheckIntervalSeconds: z.number().int().nullable(),
	healthcheckRetries: z.number().int().nullable(),
	healthcheckStartPeriodSeconds: z.number().int().nullable(),
	healthcheckTimeoutSeconds: z.number().int().nullable(),
	id: z.string(),
	image: z.string(),
	imageScanEnabled: z.boolean(),
	memoryLimitMb: z.number().int().nullable(),
	name: z.string(),
	networkMode: z.enum(["bridge", "host"]),
	portProtocol: z.enum(["tcp", "udp", "both"]),
	publishedPorts: z
		.array(
			z.object({
				containerPort: z.number().int(),
				hostPort: z.number().int(),
				protocol: z.enum(["tcp", "udp"]),
			}),
		)
		.meta({
			description:
				"Host ports bound straight to the container, for UDP and non-HTTP TCP",
		}),
	domainPorts: z.record(z.string(), z.number().int()).meta({
		description:
			"Per custom domain, the container port it routes to instead of containerPort",
	}),
	category: z.string().nullable().meta({
		description: "The app's type, a template category like database",
	}),
	icon: z.string().nullable().meta({
		description:
			"A bundled template icon file name, or an uploaded data:image URL",
	}),
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
	uptimeEnabled: z.boolean().meta({
		description:
			"Whether the per-minute internal and external uptime probes run for this service",
	}),
	userId: z.string(),
});

export const stackResponse = z.object({
	createdAt: isoTimestamp,
	description: z.string().nullable(),
	id: z.string(),
	name: z.string(),
	parentId: z.string().nullable().meta({
		description: "The stack this one is nested in, null at the top level.",
	}),
	slug: z.string(),
	updatedAt: isoTimestamp,
	userId: z.string(),
});

export const templateResponse = z.object({
	capAdd: z.array(z.string()),
	category: z.string().nullable(),
	command: z.array(z.string()).nullable(),
	containerPort: z.number().int(),
	cpuLimit: z.string().nullable(),
	createdAt: isoTimestamp,
	description: z.string().nullable(),
	devices: z.array(z.string()),
	entrypoint: z.array(z.string()).nullable(),
	envFiles: z.array(z.string()),
	envVars: z.record(z.string(), z.string()).nullable(),
	icon: z.string().nullable(),
	id: z.string(),
	image: z.string(),
	labels: z.record(z.string(), z.string()),
	memoryLimitMb: z.number().int().nullable(),
	name: z.string(),
	ownerId: z
		.string()
		.nullable()
		.meta({ description: "null = built-in template" }),
	privileged: z.boolean().meta({
		description:
			"privileged, devices, capAdd and envFiles need host access : only an admin can deploy a template that sets any of them",
	}),
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
	createdAt: isoTimestamp.meta({
		description: "When this revision was first deployed",
	}),
	current: z.boolean().meta({ description: "The revision running now" }),
	gitCommit: z.string().nullable(),
	gitRef: z.string().nullable(),
	health: z
		.enum(["watching", "healthy", "unhealthy", "rolled_back"])
		.nullable()
		.meta({
			description:
				"Health of its latest run. watching and healthy only ever appear on the current revision; unhealthy and rolled_back are kept as history; null otherwise",
		}),
	healthReason: z.string().nullable().meta({
		description:
			"Why the health watch judged it unhealthy or rolled it back (a failing healthcheck, a restart loop, failed swarm tasks and their error), null otherwise",
	}),
	id: z.string().meta({
		description:
			"The revision's original deployment id, what POST /services/{serviceId}/revisions/{revisionId}/deploy takes",
	}),
	imageDigest: z.string().nullable(),
	imageId: z.string().nullable(),
	imageRef: z.string().nullable(),
	lastDeployedAt: isoTimestamp.nullable().meta({
		description:
			"When this revision last went live, later than createdAt once it was redeployed",
	}),
	latestDeploymentId: z.string().meta({
		description:
			"The deployment row of its latest run, id itself unless it was redeployed",
	}),
	previous: z.boolean().meta({
		description:
			"The default rollback target: the newest older healthy revision with a different image",
	}),
	redeployCount: z.number().int().meta({
		description: "How many times it was redeployed (rolled back to)",
	}),
	retained: z.boolean().meta({
		description:
			"Its image is among the last distinct images kept on the host and in the mirror",
	}),
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

export const deploymentResponse = z.object({
	createdAt: isoTimestamp,
	errorMessage: z.string().nullable().meta({
		description: "Why the deploy failed, null unless status is failed",
	}),
	finishedAt: isoTimestamp.nullable(),
	gitCommit: z.string().nullable(),
	gitRef: z.string().nullable(),
	id: z.string(),
	imageDigest: z.string().nullable(),
	imageRef: z.string().nullable(),
	log: z.string().nullable().meta({
		description:
			"The deploy's progress lines as the dashboard shows them: pull, scan, rollout, and the Docker error when it failed",
	}),
	rollbackOfDeploymentId: z.string().nullable(),
	startedAt: isoTimestamp.nullable(),
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

export const successResponse = z.object({ success: z.boolean() });

export const instanceUpdateStatusResponse = z.object({
	channel: z.enum(UPDATE_CHANNELS).meta({
		description:
			"The release channel updates follow, set on Settings → General",
	}),
	checkedAt: isoTimestamp.nullable().meta({
		description: "When the channel's newest release was last looked up",
	}),
	current: z.string().meta({ description: "The running version" }),
	latest: z
		.object({
			publishedAt: isoTimestamp.nullable(),
			url: z.string(),
			version: z.string(),
		})
		.nullable()
		.meta({
			description:
				"The newest release on the channel, null when it couldn't be checked",
		}),
	preflight: z.object({
		pendingDeploys: z.number(),
		reason: z.string().nullable().meta({
			description: "Why an update can't start right now, null when ready",
		}),
		ready: z.boolean(),
		runningJobs: z.number(),
		supported: z.boolean().meta({
			description:
				"Whether this instance runs as a Docker Compose service it can recreate",
		}),
	}),
	updateAvailable: z.boolean(),
});

export const instanceUpdateChannelResponse = z.object({
	channel: z.enum(UPDATE_CHANNELS),
});

export const instanceUpdateStartResponse = z.object({
	version: z.string().meta({ description: "The version being installed" }),
});

export const instanceUpdateProgressResponse = z.object({
	exitCode: z.number().nullable().meta({
		description: "The updater's exit code once it has exited, 0 on success",
	}),
	log: z.array(z.string()).meta({ description: "The updater's output lines" }),
	state: z.enum(["exited", "none", "running"]).meta({
		description: "none when no update has run on this host",
	}),
	version: z
		.string()
		.nullable()
		.meta({ description: "The version the updater is installing" }),
});

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
	fixableCounts: severityCounts.nullable().meta({
		description:
			"Findings that have a fixed version, per severity. null on scans recorded before this was tracked",
	}),
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
	polling: z.boolean().meta({
		description:
			"Whether Homerun polls the branch head every two minutes instead of, or as well as, waiting for deliveries",
	}),
	providerName: z.string().nullable(),
	reconnect: z
		.object({ providerId: z.string(), providerName: z.string() })
		.nullable()
		.meta({
			description:
				"The provider to reconnect when it refused the webhook, usually for a missing webhook scope",
		}),
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
