import { stripAnsi } from "$lib/ansi";
import { isPhaseLine } from "$lib/deploy-phases";
import { deployEvent, deployTitle } from "$lib/notification-events";
import type { Deployment, Service } from "$lib/server/db/schema";
import type { NotificationEvent } from "$lib/types";

const LOG_TAIL_LINES = 15;

export interface MessageField {
	name: string;
	value: string;
}

export interface ChannelMessage {
	detail: string | null;
	event: NotificationEvent;
	fields: MessageField[];
	link: string | null;
	serviceId: string;
	serviceName: string;
	timestamp: string;
	title: string;
}

export interface DeployMessageInput {
	deployment: Pick<
		Deployment,
		| "errorMessage"
		| "finishedAt"
		| "gitCommit"
		| "gitRef"
		| "imageDigest"
		| "log"
		| "startedAt"
	>;
	origin: string | null;
	stackName: string | null;
	publicUrl: string | null;
	service: Pick<
		Service,
		"buildSource" | "gitRef" | "gitUrl" | "id" | "image" | "name" | "tag"
	>;
	trigger: "manual" | "cron";
}

export interface UptimeMessageInput {
	detail: string | null;
	kind: "internal" | "external";
	ok: boolean;
	origin: string | null;
	publicHost: string | null;
	service: Pick<Service, "id" | "name">;
}

export function dashboardLink(
	origin: string | null,
	path: string,
): string | null {
	return origin ? `${origin.replace(/\/$/, "")}${path}` : null;
}

export function formatDuration(
	startedAt: Date | null,
	finishedAt: Date | null,
): string | null {
	if (!(startedAt && finishedAt)) {
		return null;
	}
	const totalSeconds = Math.max(
		0,
		Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
	);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0
		? `${minutes}m ${String(seconds).padStart(2, "0")}s`
		: `${seconds}s`;
}

export function logTail(log: string | null, errorMessage: string | null) {
	const lines = stripAnsi(log ?? "")
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line && !isPhaseLine(line) && line !== errorMessage);
	return lines.slice(-LOG_TAIL_LINES).join("\n");
}

function sourceFields(
	service: DeployMessageInput["service"],
	deployment: DeployMessageInput["deployment"],
): MessageField[] {
	if (service.buildSource === "git") {
		const fields: MessageField[] = [
			{ name: "Repository", value: service.gitUrl ?? "unknown" },
			{
				name: "Branch",
				value: deployment.gitRef ?? service.gitRef ?? "main",
			},
		];
		if (deployment.gitCommit) {
			fields.push({ name: "Commit", value: deployment.gitCommit.slice(0, 7) });
		}
		return fields;
	}
	const fields: MessageField[] = [
		{ name: "Image", value: `${service.image}:${service.tag}` },
	];
	if (deployment.imageDigest) {
		fields.push({
			name: "Digest",
			value: deployment.imageDigest.replace(/^(sha256:)?(.{12}).*$/, "$1$2"),
		});
	}
	return fields;
}

export function deployMessage(
	input: DeployMessageInput,
	ok: boolean,
	timestamp: string,
): ChannelMessage {
	const { deployment, service } = input;
	const event = deployEvent(service.buildSource, input.trigger, ok);
	const fields: MessageField[] = [];
	if (input.stackName) {
		fields.push({ name: "Stack", value: input.stackName });
	}
	fields.push({
		name: "Trigger",
		value: input.trigger === "cron" ? "Scheduled" : "Manual",
	});
	fields.push(...sourceFields(service, deployment));
	const duration = formatDuration(deployment.startedAt, deployment.finishedAt);
	if (duration) {
		fields.push({ name: "Duration", value: duration });
	}
	if (ok && input.publicUrl) {
		fields.push({ name: "URL", value: input.publicUrl });
	}

	let detail: string | null = null;
	if (!ok) {
		const tail = logTail(deployment.log, deployment.errorMessage);
		detail = [deployment.errorMessage ?? "Unknown error.", tail]
			.filter(Boolean)
			.join("\n\n");
	}

	return {
		detail,
		event,
		fields,
		link: dashboardLink(input.origin, `/services/${service.id}/revisions`),
		serviceId: service.id,
		serviceName: service.name,
		timestamp,
		title: deployTitle(event, service.name),
	};
}

export function uptimeMessage(
	input: UptimeMessageInput,
	timestamp: string,
): ChannelMessage {
	const { service } = input;
	const fields: MessageField[] = [
		{
			name: "Probe",
			value:
				input.kind === "internal"
					? "Internal (Docker network)"
					: "External (public URL)",
		},
	];
	if (input.kind === "external" && input.publicHost) {
		fields.push({ name: "Host", value: input.publicHost });
	}
	return {
		detail: input.detail,
		event: input.ok ? "service.up" : "service.down",
		fields,
		link: dashboardLink(input.origin, `/services/${service.id}/observability`),
		serviceId: service.id,
		serviceName: service.name,
		timestamp,
		title: `${service.name} ${input.ok ? "recovered" : "is down"}`,
	};
}
