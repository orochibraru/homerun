import type { DeployTrigger } from "#lib/deploy-trigger.js";
import type { NotificationEvent } from "#lib/types.js";

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
			"A git build was stopped before cloning because a required status check failed or never finished.",
		event: "build.checks_failed",
		group: "Builds",
		label: "Status checks failed",
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
			"A new revision exited, restart-looped or failed its healthcheck, and auto-rollback is off.",
		event: "deploy.unhealthy",
		group: "Deploys",
		label: "Revision unhealthy",
	},
	{
		description:
			"A new revision was unhealthy, so the previous healthy revision was redeployed automatically.",
		event: "deploy.rolled_back",
		group: "Deploys",
		label: "Rolled back",
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
	{
		description:
			"The server's CPU, memory, disk or GPU crossed its soft threshold.",
		event: "resource.warning",
		group: "Server",
		label: "Resource warning",
	},
	{
		description:
			"The server crossed a hard threshold: new services are refused until it drops back.",
		event: "resource.critical",
		group: "Server",
		label: "Resource critical",
	},
	{
		description: "Every resource that crossed a threshold is back under it.",
		event: "resource.recovered",
		group: "Server",
		label: "Resources recovered",
	},
	{
		description:
			"A service with error tracking on reported an error that doesn't match any existing issue.",
		event: "error.issue.new",
		group: "Errors",
		label: "New error",
	},
	{
		description: "An error issue marked resolved happened again.",
		event: "error.issue.regressed",
		group: "Errors",
		label: "Error regressed",
	},
	{
		description:
			"A volume backup failed, after its retry. Scheduled ones are grouped into one message per run.",
		event: "backup.failed",
		group: "Scheduled tasks",
		label: "Backup failed",
	},
	{
		description: "A volume was backed up to its destination.",
		event: "backup.succeeded",
		group: "Scheduled tasks",
		label: "Backup succeeded",
	},
	{
		description:
			"A cron job exited non-zero, timed out or couldn't start. Scheduled ones are grouped into one message per run.",
		event: "cron_job.failed",
		group: "Scheduled tasks",
		label: "Cron job failed",
	},
	{
		description: "A cron job exited 0.",
		event: "cron_job.succeeded",
		group: "Scheduled tasks",
		label: "Cron job succeeded",
	},
	{
		description:
			"An address was banned for requesting services' blocked paths too often.",
		event: "security.ip_banned",
		group: "Security",
		label: "IP banned",
	},
];

export const DEFAULT_NOTIFICATION_EVENTS: NotificationEvent[] = [
	"build.failed",
	"build.checks_failed",
	"update.failed",
	"deploy.unhealthy",
	"deploy.rolled_back",
	"resource.warning",
	"resource.critical",
	"error.issue.new",
	"error.issue.regressed",
	"backup.failed",
	"cron_job.failed",
];

const EVENT_SET = new Set<string>(
	NOTIFICATION_EVENTS.map((info) => info.event),
);

/** Whether a string is a known notification event name. */
export function isNotificationEvent(value: string): value is NotificationEvent {
	return EVENT_SET.has(value);
}

/**
 * Whether an event reports something going wrong, used to colour channel
 * messages red rather than green.
 */
export function isFailureEvent(event: NotificationEvent): boolean {
	return (
		event.endsWith(".failed") ||
		event === "service.down" ||
		event === "build.checks_failed" ||
		event === "deploy.unhealthy" ||
		event === "deploy.rolled_back" ||
		event === "image.vulnerable" ||
		event === "resource.warning" ||
		event === "resource.critical" ||
		event === "security.ip_banned" ||
		event.startsWith("error.issue.")
	);
}

/**
 * Picks the notification event for a finished deploy: `build.*` for git-based
 * services (a preview promote excepted, nothing is built), `update.*` for
 * scheduled image updates, `deploy.*` otherwise.
 */
export function deployEvent(
	buildSource: string,
	trigger: DeployTrigger,
	ok: boolean,
): NotificationEvent {
	const outcome = ok ? "succeeded" : "failed";
	if (buildSource === "git" && trigger !== "promote") {
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

/**
 * Builds a deploy notification title such as "api failed to deploy", falling
 * back to the raw event name for events without a phrase.
 */
export function deployTitle(
	event: NotificationEvent,
	serviceName: string,
): string {
	return `${serviceName} ${DEPLOY_TITLES[event] ?? event}`;
}
