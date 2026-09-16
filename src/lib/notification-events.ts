import type { NotificationEvent } from "$lib/types";

export interface NotificationEventInfo {
	description: string;
	event: NotificationEvent;
	group: string;
	label: string;
}

export const NOTIFICATION_EVENTS: NotificationEventInfo[] = [
	{
		description:
			"A service built from a git repository failed to build or start.",
		event: "build.failed",
		group: "Builds",
		label: "Build failed",
	},
	{
		description:
			"A service built from a git repository was built and is running.",
		event: "build.succeeded",
		group: "Builds",
		label: "Build succeeded",
	},
	{
		description:
			"A scheduled redeploy couldn't pull the image or restart the container.",
		event: "update.failed",
		group: "Updates",
		label: "Update failed",
	},
	{
		description:
			"A scheduled redeploy pulled the image and restarted the container.",
		event: "update.succeeded",
		group: "Updates",
		label: "Update succeeded",
	},
	{
		description: "A manual deploy of an image failed.",
		event: "deploy.failed",
		group: "Deploys",
		label: "Deploy failed",
	},
	{
		description: "A manual deploy of an image is running.",
		event: "deploy.succeeded",
		group: "Deploys",
		label: "Deploy succeeded",
	},
	{
		description:
			"An image scan found at least one CRITICAL vulnerability in a service's image.",
		event: "image.vulnerable",
		group: "Security",
		label: "Critical vulnerabilities",
	},
	{
		description: "An uptime probe started failing.",
		event: "service.down",
		group: "Uptime",
		label: "Service down",
	},
	{
		description: "A failing uptime probe recovered.",
		event: "service.up",
		group: "Uptime",
		label: "Service recovered",
	},
];

export const DEFAULT_NOTIFICATION_EVENTS: NotificationEvent[] = [
	"build.failed",
	"update.failed",
];

const EVENT_SET = new Set<string>(
	NOTIFICATION_EVENTS.map((info) => info.event),
);

export function isNotificationEvent(value: string): value is NotificationEvent {
	return EVENT_SET.has(value);
}

export function isFailureEvent(event: NotificationEvent): boolean {
	return (
		event.endsWith(".failed") ||
		event === "service.down" ||
		event === "image.vulnerable"
	);
}

export function deployEvent(
	buildSource: string,
	trigger: "manual" | "cron",
	ok: boolean,
): NotificationEvent {
	const outcome = ok ? "succeeded" : "failed";
	if (buildSource === "git") {
		return `build.${outcome}`;
	}
	return trigger === "cron" ? `update.${outcome}` : `deploy.${outcome}`;
}

const DEPLOY_TITLES: Partial<Record<NotificationEvent, string>> = {
	"build.failed": "failed to build",
	"build.succeeded": "was built and deployed",
	"deploy.failed": "failed to deploy",
	"deploy.succeeded": "deployed successfully",
	"update.failed": "failed to update",
	"update.succeeded": "was updated",
};

export function deployTitle(
	event: NotificationEvent,
	serviceName: string,
): string {
	return `${serviceName} ${DEPLOY_TITLES[event] ?? event}`;
}
