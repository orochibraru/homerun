import { stripAnsi } from "$lib/ansi";
import { isPhaseLine } from "$lib/deploy-phases";
import {
	countsLine,
	type ImageScanFinding,
	type SeverityCounts,
} from "$lib/image-scan";
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

export interface ImageScanMessageInput {
	counts: SeverityCounts;
	findings: ImageScanFinding[];
	imageRef: string;
	origin: string | null;
	service: Pick<Service, "id" | "name">;
}

const TOP_CRITICAL_LINES = 10;

export function imageScanMessage(
	input: ImageScanMessageInput,
	timestamp: string,
): ChannelMessage {
	const { service } = input;
	const critical = input.findings
		.filter((finding) => finding.severity === "CRITICAL")
		.slice(0, TOP_CRITICAL_LINES)
		.map(
			(finding) =>
				`${finding.id} ${finding.pkg} ${finding.installedVersion}${finding.fixedVersion ? ` (fixed in ${finding.fixedVersion})` : ""}`,
		);
	return {
		detail: critical.length > 0 ? critical.join("\n") : null,
		event: "image.vulnerable",
		fields: [
			{ name: "Image", value: input.imageRef },
			{ name: "Findings", value: countsLine(input.counts) },
		],
		link: dashboardLink(input.origin, `/services/${service.id}/security`),
		serviceId: service.id,
		serviceName: service.name,
		timestamp,
		title: `${service.name} has ${input.counts.critical} critical ${input.counts.critical === 1 ? "vulnerability" : "vulnerabilities"}`,
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

export interface StatusChecksMessageInput {
	commit: string | null;
	failed: string[];
	missing: string[];
	origin: string | null;
	pending: string[];
	reason: string;
	service: Pick<Service, "gitRef" | "gitUrl" | "id" | "name">;
	stackName: string | null;
}

export function statusChecksMessage(
	input: StatusChecksMessageInput,
	timestamp: string,
): ChannelMessage {
	const { service } = input;
	const fields: MessageField[] = [];
	if (input.stackName) {
		fields.push({ name: "Stack", value: input.stackName });
	}
	fields.push(
		{ name: "Repository", value: service.gitUrl ?? "unknown" },
		{ name: "Branch", value: service.gitRef ?? "main" },
	);
	if (input.commit) {
		fields.push({ name: "Commit", value: input.commit.slice(0, 7) });
	}
	const checks: Array<[string, string[]]> = [
		["Failed checks", input.failed],
		["Never reported", input.missing],
		["Still running", input.pending],
	];
	for (const [name, names] of checks) {
		if (names.length > 0) {
			fields.push({ name, value: names.join(", ") });
		}
	}
	return {
		detail: `${input.reason}\n\nThe build will not carry on. Fix the checks and redeploy.`,
		event: "build.checks_failed",
		fields,
		link: dashboardLink(input.origin, `/services/${service.id}/revisions`),
		serviceId: service.id,
		serviceName: service.name,
		timestamp,
		title: `${service.name} was not built: status checks failed`,
	};
}

export interface RevisionHealthMessageInput {
	origin: string | null;
	reason: string;
	revision: Pick<Deployment, "gitCommit" | "id" | "imageRef">;
	rolledBackTo: Pick<Deployment, "gitCommit" | "id" | "imageRef"> | null;
	service: Pick<Service, "id" | "name">;
	skipReason: string | null;
}

function revisionLabel(
	revision: Pick<Deployment, "gitCommit" | "id" | "imageRef">,
): string {
	const commit = revision.gitCommit
		? ` @ ${revision.gitCommit.slice(0, 7)}`
		: "";
	return `${revision.imageRef ?? revision.id.slice(0, 8)}${commit}`;
}

export function revisionHealthMessage(
	input: RevisionHealthMessageInput,
	timestamp: string,
): ChannelMessage {
	const { rolledBackTo, service } = input;
	const fields: MessageField[] = [
		{ name: "Unhealthy revision", value: revisionLabel(input.revision) },
	];
	if (rolledBackTo) {
		fields.push({ name: "Rolled back to", value: revisionLabel(rolledBackTo) });
	}
	const detail = [input.reason, input.skipReason].filter(Boolean).join("\n\n");
	return {
		detail,
		event: rolledBackTo ? "deploy.rolled_back" : "deploy.unhealthy",
		fields,
		link: dashboardLink(input.origin, `/services/${service.id}/revisions`),
		serviceId: service.id,
		serviceName: service.name,
		timestamp,
		title: rolledBackTo
			? `${service.name} was rolled back: the new revision is unhealthy`
			: `${service.name}'s new revision is unhealthy`,
	};
}
