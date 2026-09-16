import { config, isSmtpEnabled } from "$lib/config";
import type { DeploymentDTO } from "$lib/dto/deployment-dto";
import { NotificationChannelDTO } from "$lib/dto/notification-channel-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import { isFailureEvent, NOTIFICATION_EVENTS } from "$lib/notification-events";
import { serviceHostname } from "./dns.service";
import { EmailService } from "./email.service";
import { type ChannelMessage, deployMessage } from "./notification-messages";

const logger = new Logger("NotificationChannels");

const WEBHOOK_TIMEOUT_MS = 10_000;

const DISCORD_DESCRIPTION_LIMIT = 4000;
const DISCORD_FIELD_LIMIT = 1024;
const DISCORD_INLINE_MAX = 40;

const DISCORD_RED = 0xef_44_44;
const DISCORD_GREEN = 0x10_b9_81;

export interface DeployNotification {
	dep: DeploymentDTO;
	ok: boolean;
	svc: ServiceDTO;
	trigger: "manual" | "cron";
}

function keepTail(text: string, limit: number): string {
	return text.length > limit ? `…${text.slice(-limit)}` : text;
}

function keepHead(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** The email subject line for a channel message. */
export function messageSubject(message: ChannelMessage): string {
	return `[Homerun] ${message.title}`;
}

/** Renders a channel message as plain-text body lines, for email and the generic webhook payload. */
export function messageBody(message: ChannelMessage): string {
	const label =
		NOTIFICATION_EVENTS.find((info) => info.event === message.event)?.label ??
		message.event;
	const lines = [
		message.title,
		"",
		`Service: ${message.serviceName}`,
		`Event: ${label}`,
		...message.fields.map((field) => `${field.name}: ${field.value}`),
		`At: ${message.timestamp}`,
	];
	if (message.link) {
		lines.push(`Open: ${message.link}`);
	}
	if (message.detail) {
		lines.push("", message.detail);
	}
	return lines.join("\n");
}

/** Renders a channel message as a Discord webhook embed payload, truncated to Discord's own field/description limits. */
export function discordPayload(message: ChannelMessage) {
	const detail = message.detail
		? keepTail(message.detail, DISCORD_DESCRIPTION_LIMIT)
		: "";
	return {
		embeds: [
			{
				color: isFailureEvent(message.event) ? DISCORD_RED : DISCORD_GREEN,
				description: detail ? `\`\`\`\n${detail}\n\`\`\`` : undefined,
				fields: [
					{ name: "Service", value: message.serviceName },
					...message.fields,
				].map((field) => ({
					inline: field.value.length <= DISCORD_INLINE_MAX,
					name: field.name,
					value: keepHead(field.value, DISCORD_FIELD_LIMIT),
				})),
				footer: { text: message.event },
				timestamp: message.timestamp,
				title: message.title,
				url: message.link ?? undefined,
			},
		],
		username: "Homerun",
	};
}

class NotificationChannelServiceClass {
	/**
	 * Fire-and-forget dispatch of `message` to every channel the user has
	 * subscribed to that event on. Failures are logged, never thrown to the
	 * caller.
	 */
	notify(userId: string, message: ChannelMessage): void {
		this.dispatch(userId, message).catch((err) => {
			logger.warn(
				`Channel dispatch failed: event=${message.event} : ${err instanceof Error ? err.message : String(err)}`,
			);
		});
	}

	/**
	 * Fire-and-forget deploy-outcome notification: builds the deploy message
	 * (looking up the service's stack for its hostname) and dispatches it.
	 * Failures are logged, never thrown to the caller.
	 */
	notifyDeploy(notification: DeployNotification): void {
		this.#deployMessage(notification)
			.then((message) => this.dispatch(notification.svc.userId, message))
			.catch((err) => {
				logger.warn(
					`Deploy notification failed: service=${notification.svc.id} : ${err instanceof Error ? err.message : String(err)}`,
				);
			});
	}

	/** Builds the deploy-outcome `ChannelMessage`, resolving the service's public URL from its stack (if any) and DNS-resolvable state. */
	async #deployMessage({
		dep: deployment,
		ok,
		svc: service,
		trigger,
	}: DeployNotification): Promise<ChannelMessage> {
		const stack = service.stackId
			? await StackDTO.get(service.stackId, service.userId)
			: null;
		const row = service.toJSON();
		const host =
			row.customDomain ?? serviceHostname(row.slug, stack?.slug ?? null);
		return deployMessage(
			{
				deployment: deployment.toJSON(),
				origin: config.auth.origin ?? null,
				stackName: stack?.name ?? null,
				publicUrl: row.dnsResolvable ? `https://${host}` : null,
				service: row,
				trigger,
			},
			ok,
			new Date().toISOString(),
		);
	}

	/** Delivers `message` to every channel the user has subscribed to that event on, in parallel. Per-channel failures don't reject; see `#send`. */
	async dispatch(userId: string, message: ChannelMessage): Promise<void> {
		const channels = await NotificationChannelDTO.listSubscribed(
			userId,
			message.event,
		);
		await Promise.all(channels.map((channel) => this.#send(channel, message)));
	}

	/**
	 * Sends a synthetic "build failed" message directly to one channel (the
	 * Settings page's "Send test notification" button), bypassing event
	 * subscription filtering, and clears the channel's stored `lastError` on
	 * success.
	 *
	 * @throws Whatever `#deliver` throws for that channel kind.
	 */
	async sendTest(channel: NotificationChannelDTO): Promise<void> {
		await this.#deliver(channel, {
			detail: "This is a test notification from Homerun.",
			event: "build.failed",
			fields: [
				{ name: "Trigger", value: "Manual" },
				{ name: "Repository", value: "https://github.com/example/app.git" },
				{ name: "Branch", value: "main" },
				{ name: "Commit", value: "0000000" },
				{ name: "Duration", value: "42s" },
			],
			link: null,
			serviceId: "test",
			serviceName: "Test service",
			timestamp: new Date().toISOString(),
			title: "Test service failed to build",
		});
		await channel.update({ lastError: null });
	}

	/**
	 * Delivers to one channel, recording the outcome on the channel row
	 * itself (`lastError` cleared on success, set to the failure message
	 * otherwise) rather than throwing, so one bad channel doesn't affect the
	 * others in `dispatch`'s `Promise.all`.
	 */
	async #send(
		channel: NotificationChannelDTO,
		message: ChannelMessage,
	): Promise<void> {
		try {
			await this.#deliver(channel, message);
			await channel.update({ lastError: null });
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			logger.warn(`Channel "${channel.name}" failed: ${reason}`);
			await channel.update({ lastError: reason });
		}
	}

	/** Routes delivery to the channel-kind-specific sender: Discord's embed payload, email, or the generic JSON webhook POST. */
	#deliver(
		channel: NotificationChannelDTO,
		message: ChannelMessage,
	): Promise<void> {
		switch (channel.kind) {
			case "discord":
				return this.#post(channel.target, discordPayload(message));
			case "email":
				return this.#sendEmail(channel.target, message);
			default:
				return this.#post(channel.target, message);
		}
	}

	/**
	 * POSTs `body` as JSON to a generic webhook URL.
	 *
	 * @throws When the request times out (`WEBHOOK_TIMEOUT_MS`) or the
	 *   response isn't ok.
	 */
	async #post(url: string, body: unknown): Promise<void> {
		const response = await fetch(url, {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
			method: "POST",
			signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(`Webhook returned HTTP ${response.status}`);
		}
	}

	/**
	 * Sends a channel message by email.
	 *
	 * @throws When SMTP isn't configured on this instance.
	 */
	async #sendEmail(to: string, message: ChannelMessage): Promise<void> {
		if (!isSmtpEnabled()) {
			throw new Error(
				"SMTP isn't configured, so email notifications can't be sent.",
			);
		}
		await new EmailService({
			content: messageBody(message),
			subject: messageSubject(message),
			to,
		}).send();
	}
}

export const NotificationChannelService = new NotificationChannelServiceClass();
