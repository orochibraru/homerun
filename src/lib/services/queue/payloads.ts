import { z } from "zod";

export const deployJobPayload = z.object({
	deploymentId: z.string(),
	serviceId: z.string(),
	trigger: z.enum(["manual", "cron"]).default("manual"),
	userId: z.string(),
});

export const backupJobPayload = z.object({
	userId: z.string(),
	volumeId: z.string(),
});

export const dockerCleanupActions = [
	"pruneBuildCache",
	"pruneContainers",
	"pruneImages",
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
