// Shared client-safe types. $lib/services/docker/containers.ts imports
// dockerode/node:crypto and can't be imported from client-reachable code
// (SvelteKit blocks it) : so status-adjacent types that both server logic
// and UI components need live here instead.
export type ContainerStatus =
	| "pending"
	| "pulling"
	| "starting"
	| "running"
	| "stopped"
	| "failed"
	| "missing";

export type JobStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled";

export type JobType =
	| "backup"
	| "cron_job"
	| "deploy"
	| "docker_cleanup"
	| "image_scan";

export type StatusPageScope = "global" | "stack" | "custom";

export type NotificationChannelKind = "webhook" | "discord" | "email";

export type NotificationEvent =
	| "build.failed"
	| "build.succeeded"
	| "update.failed"
	| "update.succeeded"
	| "deploy.failed"
	| "deploy.succeeded"
	| "image.vulnerable"
	| "service.down"
	| "service.up";

export type ServiceHealth = "up" | "down" | "unknown";

export type PullPolicy = "always" | "missing" | "never";
