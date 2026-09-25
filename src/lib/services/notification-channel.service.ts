import { config, isSmtpEnabled } from "$lib/config";
import type { DeployTrigger } from "$lib/deploy-trigger";
import type { DeploymentDTO } from "$lib/dto/deployment-dto";
import type { NewJobInput } from "$lib/dto/job-dto";
import { NotificationChannelDTO } from "$lib/dto/notification-channel-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import { parseTelegramTarget } from "$lib/notification-channel-target";
import { isFailureEvent, NOTIFICATION_EVENTS } from "$lib/notification-events";
import { primaryHostname } from "$lib/service-domains";
import { serviceHostname } from "./dns.service";
import { EmailService } from "./email.service";
import {
	type ChannelMessage,
	deployMessage,
	type MessageField,
	withStackTitle,
} from "./notification-messages";
import { QueueService } from "./queue.service";

const logger = new Logger("NotificationChannels");

const WEBHOOK_TIMEOUT_MS = 10_000;

const DELIVERY_RETRY_ATTEMPTS = 4;
const DELIVERY_RETRY_DELAY_MS = 30_000;

const SLACK_TEXT_LIMIT = 2900;
const SLACK_INLINE_MAX = 40;
const SLACK_RED = "#ef4444";
const SLACK_GREEN = "#10b981";

const TELEGRAM_API = "https://api.telegram.org";
const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_DETAIL_LIMIT = 2500;

const DISCORD_DESCRIPTION_LIMIT = 4000;
const DISCORD_FIELD_LIMIT = 1024;
const DISCORD_INLINE_MAX = 40;

const DISCORD_RED = 0xef_44_44;
const DISCORD_GREEN = 0x10_b9_81;

export interface DeployNotification {
	dep: DeploymentDTO;
	ok: boolean;
	svc: ServiceDTO;
	trigger: DeployTrigger;
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

/** A message's fields with its service first, or just its fields for a message about the whole server. */
function withService(message: ChannelMessage): MessageField[] {
	return message.serviceName
		? [{ name: "Service", value: message.serviceName }, ...message.fields]
		: message.fields;
}

/** Renders a channel message as plain-text body lines, for email and the generic webhook payload. */
export function messageBody(message: ChannelMessage): string {
	const label =
		NOTIFICATION_EVENTS.find((info) => info.event === message.event)?.label ??
		message.event;
	const lines = [
		message.title,
		"",
		...(message.serviceName ? [`Service: ${message.serviceName}`] : []),
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
				fields: withService(message).map((field) => ({
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

/** Renders a channel message as a Slack incoming-webhook payload: a coloured attachment with the fields and the detail's tail. */
export function slackPayload(message: ChannelMessage) {
	const detail = message.detail
		? `\`\`\`${keepTail(message.detail, SLACK_TEXT_LIMIT)}\`\`\``
		: undefined;
	return {
		attachments: [
			{
				color: isFailureEvent(message.event) ? SLACK_RED : SLACK_GREEN,
				fallback: message.title,
				fields: withService(message).map((field) => ({
					short: field.value.length <= SLACK_INLINE_MAX,
					title: field.name,
					value: keepHead(field.value, SLACK_TEXT_LIMIT),
				})),
				footer: message.event,
				text: detail,
				title: message.title,
				title_link: message.link ?? undefined,
				ts: Math.floor(Date.parse(message.timestamp) / 1000),
			},
		],
		text: message.title,
	};
}

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/** Renders a channel message as a Telegram `sendMessage` body in HTML parse mode, kept under Telegram's 4096-character limit. */
export function telegramPayload(chatId: string, message: ChannelMessage) {
	const lines = [
		`<b>${escapeHtml(message.title)}</b>`,
		"",
		...withService(message).map(
			(field) => `<b>${escapeHtml(field.name)}:</b> ${escapeHtml(field.value)}`,
		),
	];
	if (message.link) {
		lines.push(`<a href="${escapeHtml(message.link)}">Open in Homerun</a>`);
	}
	if (message.detail) {
		lines.push(
			"",
			`<pre>${escapeHtml(keepTail(message.detail, TELEGRAM_DETAIL_LIMIT))}</pre>`,
		);
	}
	const text = lines.join("\n");
	return {
		chat_id: chatId,
		disable_web_page_preview: true,
		parse_mode: "HTML",
		text:
			text.length > TELEGRAM_TEXT_LIMIT
				? escapeHtml(keepHead(messageBody(message), TELEGRAM_TEXT_LIMIT - 10))
				: text,
	};
}

/**
 * The queued job that retries a failed delivery to one channel, starting
 * `DELIVERY_RETRY_DELAY_MS` from `now` and backing off exponentially through
 * the worker's own retry schedule.
 */
export function deliveryRetryJob(
	channel: { id: string; name: string; userId: string },
	message: ChannelMessage,
	now = new Date(),
): NewJobInput {
	return {
		maxAttempts: DELIVERY_RETRY_ATTEMPTS,
		payload: { channelId: channel.id, message: { ...message } },
		runAt: new Date(now.getTime() + DELIVERY_RETRY_DELAY_MS),
		title: `Deliver "${message.title}" to ${channel.name}`,
		type: "notification_delivery",
		userId: channel.userId,
	};
}

class NotificationChannelServiceClass {
	/**
	 * Fire-and-forget dispatch of `message` to every account's channels
	 * subscribed to that event. Failures are logged, never thrown to the
	 * caller.
	 */
	notify(message: ChannelMessage): void {
		this.dispatch(message).catch((err) => {
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
			.then((message) => this.dispatch(message))
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
		const stack = service.stackId ? await StackDTO.get(service.stackId) : null;
		const row = service.toJSON();
		const host =
			primaryHostname(row, stack?.slug, config.baseDomain) ??
			serviceHostname(row.slug, stack?.slug ?? null);
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

	/** Delivers `message` to every account's enabled channels subscribed to that event, in parallel. Per-channel failures don't reject; see `#send`. */
	async dispatch(message: ChannelMessage): Promise<void> {
		const channels = await NotificationChannelDTO.listSubscribed(message.event);
		if (channels.length === 0) {
			return;
		}
		const titled = withStackTitle(
			message,
			message.serviceId ? await this.#stackNameOf(message.serviceId) : null,
		);
		await Promise.all(channels.map((channel) => this.#send(channel, titled)));
	}

	/** The name of the stack `serviceId` belongs to, null for an ungrouped or unknown service, or when the lookup fails. */
	async #stackNameOf(serviceId: string): Promise<string | null> {
		try {
			const svc = await ServiceDTO.get(serviceId);
			const stack = svc?.stackId ? await StackDTO.get(svc.stackId) : null;
			return stack?.name ?? null;
		} catch {
			return null;
		}
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
	 * Retries one queued delivery (the `notification_delivery` job handler).
	 * A channel deleted, disabled or unsubscribed from the event since is
	 * skipped rather than failed.
	 *
	 * @throws Whatever `#deliver` throws, after recording it as the channel's
	 * `lastError`, so the worker schedules the next attempt.
	 */
	async retryDelivery(
		channelId: string,
		message: ChannelMessage,
	): Promise<{ delivered: boolean }> {
		const channel = await NotificationChannelDTO.getForDelivery(channelId);
		if (!(channel?.enabled && channel.events.includes(message.event))) {
			return { delivered: false };
		}
		try {
			await this.#deliver(channel, message);
		} catch (err) {
			await channel.update({
				lastError: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
		await channel.update({ lastError: null });
		return { delivered: true };
	}

	/**
	 * Delivers to one channel, recording the outcome on the channel row
	 * itself (`lastError` cleared on success, set to the failure message
	 * otherwise) rather than throwing, so one bad channel doesn't affect the
	 * others in `dispatch`'s `Promise.all`. A failed delivery is queued for
	 * retry with backoff (`deliveryRetryJob`).
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
			logger.warn(
				`Channel "${channel.name}" failed, retrying later: ${reason}`,
			);
			await channel.update({ lastError: reason });
			await QueueService.enqueue(deliveryRetryJob(channel, message)).catch(
				(queueErr) => {
					logger.error(
						`Couldn't queue a retry for channel "${channel.name}"`,
						queueErr,
					);
				},
			);
		}
	}

	/** Routes delivery to the channel-kind-specific sender: Discord's embed payload, Slack's attachment, Telegram's bot API, email, or the generic JSON webhook POST. */
	#deliver(
		channel: NotificationChannelDTO,
		message: ChannelMessage,
	): Promise<void> {
		switch (channel.kind) {
			case "discord":
				return this.#post(channel.target, discordPayload(message));
			case "slack":
				return this.#post(channel.target, slackPayload(message));
			case "telegram":
				return this.#sendTelegram(channel.target, message);
			case "email":
				return this.#sendEmail(channel.target, message);
			default:
				return this.#post(channel.target, message);
		}
	}

	/**
	 * Sends a channel message through the Telegram Bot API's `sendMessage`.
	 *
	 * @throws When the stored target isn't a bot token and chat id, the request
	 *   times out, or Telegram rejects it (with Telegram's own description,
	 *   never the bot token).
	 */
	async #sendTelegram(target: string, message: ChannelMessage): Promise<void> {
		const parsed = parseTelegramTarget(target);
		if (!parsed) {
			throw new Error("The Telegram channel has no bot token and chat id.");
		}
		let response: Response;
		try {
			response = await fetch(
				`${TELEGRAM_API}/bot${parsed.botToken}/sendMessage`,
				{
					body: JSON.stringify(telegramPayload(parsed.chatId, message)),
					headers: { "content-type": "application/json" },
					method: "POST",
					signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
				},
			);
		} catch (err) {
			const reason =
				err instanceof Error && err.name === "TimeoutError"
					? "timed out"
					: "couldn't be reached";
			throw new Error(`Telegram ${reason}`);
		}
		if (!response.ok) {
			const body = (await response.json().catch(() => null)) as {
				description?: string;
			} | null;
			throw new Error(
				`Telegram returned HTTP ${response.status}${body?.description ? `: ${body.description}` : ""}`,
			);
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
