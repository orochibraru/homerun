import { z } from "zod";
import { BAKE_TARGET_PATTERN, BUILD_METHODS } from "#lib/build-methods.js";
import { branchPatternProblem } from "#lib/preview-branches.js";
import { environmentNameField } from "#lib/server/validation/environment-name.js";
import { DOMAIN_RE } from "#lib/service-domains.js";
import { isRunAsUser } from "#lib/service-runtime.js";
import { UPDATE_CHANNELS } from "#lib/update-channel.js";

const branchPatterns = z
	.array(z.string().trim().min(1))
	.max(50)
	.superRefine((patterns, ctx) => {
		const problem = patterns.map(branchPatternProblem).find(Boolean);
		if (problem) {
			ctx.addIssue({ code: "custom", message: problem });
		}
	});

/**
 * Request-body schemas for the JSON REST API (`src/routes/api/v1/**`) : kept
 * separate from `validation/service.ts`'s FormData-shaped schemas (checkbox/
 * `envKey[]`/`envValue[]` preprocessing that only makes sense for an HTML
 * form submission). These are also the single source of truth the OpenAPI
 * spec (`#lib/openapi/`) is generated from via `z.toJSONSchema()` : the same
 * schema instance validates a request *and* documents it, so the two can't
 * drift the way a hand-maintained spec would.
 */

const SLUG_RE = /^[a-z0-9-]{1,63}$/;

const argvField = z
	.array(z.string())
	.max(200)
	.nullable()
	.meta({ description: "Argv list, null keeps the image's own" });

const runtimeFields = {
	capAdd: z.array(z.string().regex(/^(CAP_)?[A-Za-z_]+$/)).max(50),
	command: argvField,
	devices: z
		.array(z.string().min(1))
		.max(50)
		.meta({ description: "host[:container[:rwm]] device mappings" }),
	entrypoint: argvField,
	envFiles: z
		.array(z.string().regex(/^\//))
		.max(20)
		.meta({ description: "Absolute host paths of .env files read at deploy" }),
	labels: z.record(z.string(), z.string()),
	privileged: z.boolean(),
	runAsUser: z
		.string()
		.refine(isRunAsUser, "Use uid, uid:gid, name or name:group.")
		.nullable()
		.meta({
			description:
				"Docker User (uid, uid:gid, name or name:group), null keeps the image's",
		}),
};

export const createServiceApiBody = z
	.object({
		authRequired: z.boolean().default(false),
		autoDeployOnPush: z.boolean().default(false),
		buildSource: z.enum(["image", "git"]).default("image"),
		containerPort: z.number().int().min(1).max(65_535),
		capAdd: runtimeFields.capAdd.default([]),
		command: runtimeFields.command.optional(),
		cpuLimit: z.string().optional(),
		devices: runtimeFields.devices.default([]),
		dnsResolvable: z.boolean().default(true),
		entrypoint: runtimeFields.entrypoint.optional(),
		envFiles: runtimeFields.envFiles.default([]),
		envVars: z.record(z.string(), z.string()).default({}),
		gitBakeFile: z.string().optional(),
		gitBuildTarget: z.string().regex(BAKE_TARGET_PATTERN).optional(),
		gitBuildContext: z.string().optional(),
		gitBuildMethod: z.enum(BUILD_METHODS).default("dockerfile"),
		gitDockerfilePath: z.string().optional(),
		gitProviderId: z.string().optional(),
		gitRef: z.string().optional(),
		gitRepo: z.string().optional(),
		gitUrl: z.string().optional(),
		image: z.string().optional(),
		labels: runtimeFields.labels.default({}),
		memoryLimitMb: z.number().int().positive().optional(),
		name: z.string().min(1).max(100),
		privileged: runtimeFields.privileged.default(false),
		runAsUser: runtimeFields.runAsUser.optional(),
		stackId: z.string().optional(),
		pullPolicy: z.enum(["always", "missing", "never"]).default("always"),
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
	autoDeployOnPush: z.boolean().optional(),
	autoRollback: z.boolean().optional(),
	buildSource: z.enum(["image", "git"]).optional(),
	capAdd: runtimeFields.capAdd.optional(),
	command: runtimeFields.command.optional(),
	containerPort: z.number().int().min(1).max(65_535).optional(),
	cpuLimit: z.string().nullable().optional(),
	defaultDomainEnabled: z.boolean().optional(),
	domains: z.array(z.string().trim().toLowerCase().regex(DOMAIN_RE)).optional(),
	primaryDomain: z.string().trim().toLowerCase().nullable().optional(),
	devices: runtimeFields.devices.optional(),
	dnsResolvable: z.boolean().optional(),
	entrypoint: runtimeFields.entrypoint.optional(),
	envFiles: runtimeFields.envFiles.optional(),
	envVars: z.record(z.string(), z.string()).optional(),
	environmentName: environmentNameField
		.optional()
		.describe(
			"The environment this service's deployments are recorded under, e.g. staging. null or production resets it to production. Canaries and previews keep canary and preview.",
		),
	gitBakeFile: z.string().nullable().optional(),
	gitBuildTarget: z.string().regex(BAKE_TARGET_PATTERN).nullable().optional(),
	gitBuildContext: z.string().nullable().optional(),
	gitBuildMethod: z.enum(BUILD_METHODS).optional(),
	gitDockerfilePath: z.string().nullable().optional(),
	gitProviderId: z.string().nullable().optional(),
	gitRef: z.string().nullable().optional(),
	gitRepo: z.string().nullable().optional(),
	gitUrl: z.string().nullable().optional(),
	gitPollEnabled: z.boolean().optional(),
	healthcheckCommand: z.string().max(1000).nullable().optional(),
	image: z.string().min(1).optional(),
	imageScanEnabled: z.boolean().optional(),
	previewsEnabled: z.boolean().optional(),
	previewBranchInclude: branchPatterns
		.optional()
		.describe(
			"Glob patterns (* any run, ? one character) a pull request's head branch must match one of to get a preview. Empty lets every branch through.",
		),
	previewInheritEnv: z
		.boolean()
		.optional()
		.describe(
			"Whether pull request previews start from this service's environment variables.",
		),
	previewEnvOverrides: z
		.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string())
		.optional()
		.describe(
			"Environment variables set on every preview over what it inherited; {pr}, {branch} and {slug} are filled in.",
		),
	previewCopyVolumes: z
		.boolean()
		.optional()
		.describe(
			"Whether each new preview gets its own copy of this service's volumes.",
		),
	previewBranchExclude: branchPatterns
		.optional()
		.describe(
			"Glob patterns whose matching branches never get a preview, even when included.",
		),
	labels: runtimeFields.labels.optional(),
	memoryLimitMb: z.number().int().positive().nullable().optional(),
	name: z.string().min(1).max(100).optional(),
	privileged: runtimeFields.privileged.optional(),
	runAsUser: runtimeFields.runAsUser.optional(),
	pullPolicy: z.enum(["always", "missing", "never"]).optional(),
	registryPassword: z.string().optional(),
	registryUrl: z.string().nullable().optional(),
	registryUsername: z.string().nullable().optional(),
	requireStatusChecks: z.boolean().optional(),
	requiredStatusChecks: z.array(z.string().min(1).max(200)).max(50).optional(),
	restartPolicy: z
		.enum(["no", "always", "on-failure", "unless-stopped"])
		.optional(),
	tag: z.string().min(1).optional(),
	uptimeEnabled: z.boolean().optional(),
});

/** `POST /services/{serviceId}/deploy`'s optional body: a tag to switch the service to before deploying, for CI deploying the image it just pushed. */
export const deployServiceApiBody = z.object({
	tag: z
		.string()
		.regex(
			/^[\w][\w.-]{0,127}$/,
			"A Docker tag: letters, digits, _, . and -, up to 128 characters.",
		)
		.optional()
		.describe(
			"Image tag to deploy. Saved on the service first, so later deploys keep it. Image-based services only.",
		),
	environment: z
		.enum(["stable", "production", "canary"])
		.optional()
		.describe(
			"With release channels on: canary deploys the canary service from the canary branch, stable (or production) the service itself at its current ref. Defaults to stable.",
		),
});

export const releaseChannelsApiBody = z.object({
	branch: z
		.string()
		.trim()
		.min(1)
		.optional()
		.describe(
			"The branch that feeds the canary. Defaults to the one already set, else the service's branch.",
		),
	canaryDomain: z
		.string()
		.trim()
		.toLowerCase()
		.nullable()
		.optional()
		.describe(
			"A custom domain for the canary, null for none (it keeps its default <slug>-canary hostname). Omit to keep the current one.",
		),
	enabled: z
		.boolean()
		.describe(
			"Turn release channels on or off. Off deletes the canary service.",
		),
	tagPattern: z
		.string()
		.trim()
		.min(1)
		.optional()
		.describe(
			"Glob a pushed tag must match to deploy the stable service, e.g. v*. Defaults to the one already set.",
		),
});

export const createStackApiBody = z.object({
	description: z.string().optional(),
	name: z.string().min(1).max(100),
	slug: z.string().regex(SLUG_RE),
});

export const startUpdateApiBody = z.object({
	force: z.boolean().optional().meta({
		description:
			"Update even while deploys are queued or jobs are running. They're interrupted by the restart, then resumed or run again by the new version",
	}),
});

export const updateChannelApiBody = z.object({
	channel: z.enum(UPDATE_CHANNELS).meta({
		description:
			"stable follows stable releases; canary every build merged to main that passed e2e; nightly every build merged to main, published before e2e. Switching to a more stable channel never downgrades",
	}),
});

/** `POST /services/{serviceId}/previews/{prNumber}/promote`'s optional body: the commit CI tested, refused when the preview runs another one. */
export const promotePreviewApiBody = z.object({
	commit: z
		.string()
		.regex(/^[0-9a-f]{7,40}$/i, "A full or abbreviated (7+) commit SHA.")
		.optional()
		.describe(
			"The commit the preview must be running, e.g. the pull request head CI tested. Omitted, whatever the preview runs is promoted.",
		),
});

/** `PUT /services/{serviceId}/dependencies`'s body: the full set of services it depends on, replacing the recorded ones. */
export const serviceDependenciesApiBody = z.object({
	dependsOn: z
		.array(z.string().min(1))
		.max(200)
		.describe(
			"Ids of the services this one depends on, started before it. An empty list clears the recorded ones; env links are left alone.",
		),
});

/** `PATCH /services/{serviceId}/errors/{issueId}`'s body: the issue's new status. */
export const errorIssueStatusApiBody = z.object({
	status: z
		.enum(["unresolved", "resolved", "ignored"])
		.describe(
			"resolved: marked fixed, a new event reopens it as a regression; ignored: kept counting but never notifies; unresolved: open.",
		),
});

export const sourceMapReleaseParam = z
	.string()
	.trim()
	.min(1, "Name the release the maps belong to.")
	.max(200);

export const redirectApiBody = z.object({
	destination: z.string().optional().meta({
		description: "The full http(s) URL to send requests to",
	}),
	enabled: z.boolean().optional(),
	keepPath: z.boolean().optional().meta({
		description:
			"Append the rest of the path and the query string to the destination",
	}),
	permanent: z.boolean().optional().meta({
		description: "308 when true, 307 otherwise",
	}),
	source: z.string().optional().meta({
		description:
			'A hostname with an optional path prefix, e.g. "old.example.com" or "example.com/blog"',
	}),
});
