import { z } from "zod";
import { DEPLOY_TRIGGERS } from "$lib/deploy-trigger";

export const deployJobPayload = z.object({
	deploymentId: z.string(),
	serviceId: z.string(),
	trigger: z.enum(DEPLOY_TRIGGERS).default("manual"),
	userId: z.string(),
});

export const cronJobPayload = z.object({
	cronJobId: z.string(),
	userId: z.string(),
});

export const imageScanJobPayload = z.object({
	serviceId: z.string(),
	userId: z.string(),
});

export const backupJobPayload = z.object({
	userId: z.string(),
	volumeId: z.string(),
});

export const dockerCleanupActions = [
	"reclaimStackNetworks",
	"pruneBuildCache",
	"pruneContainers",
	"pruneImages",
	"pruneMirror",
	"pruneNetworks",
	"pruneSystem",
	"pruneVolumes",
] as const;

export const dockerCleanupJobPayload = z.object({
	action: z.enum(dockerCleanupActions),
	all: z.boolean().default(false),
});

export type DockerCleanupAction = (typeof dockerCleanupActions)[number];
export type DeployJobPayload = z.infer<typeof deployJobPayload>;
