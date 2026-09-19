import { z } from "zod";
import { DEPLOY_TRIGGERS } from "$lib/deploy-trigger";
import { isNotificationEvent } from "$lib/notification-events";
import type { NotificationEvent } from "$lib/types";

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

export const backupRestoreJobPayload = z.object({
	key: z.string().min(1),
	stopServices: z.boolean().default(false),
	userId: z.string(),
	volumeId: z.string(),
	wipe: z.boolean().default(false),
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

export const notificationDeliveryJobPayload = z.object({
	channelId: z.string(),
	message: z.object({
		detail: z.string().nullable(),
		event: z.custom<NotificationEvent>(
			(value) => typeof value === "string" && isNotificationEvent(value),
		),
		fields: z.array(z.object({ name: z.string(), value: z.string() })),
		link: z.string().nullable(),
		serviceId: z.string(),
		serviceName: z.string(),
		timestamp: z.string(),
		title: z.string(),
	}),
});

export type DockerCleanupAction = (typeof dockerCleanupActions)[number];
