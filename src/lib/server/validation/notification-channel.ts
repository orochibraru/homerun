import { z } from "zod";
import {
	formatTelegramTarget,
	parseTelegramTarget,
} from "$lib/notification-channel-target";
import type { NotificationChannelKind } from "$lib/types";

const DISCORD_HOSTS = new Set([
	"discord.com",
	"discordapp.com",
	"canary.discord.com",
	"ptb.discord.com",
]);

const SLACK_HOST = "hooks.slack.com";
const SLACK_PATHS = ["/services/", "/triggers/", "/workflows/"];
const TELEGRAM_BOT_TOKEN = /^\d+:[\w-]{30,}$/;
const TELEGRAM_CHAT_ID = /^(-?\d+|@\w{5,})$/;

export const notificationChannelSchema = z.object({
	kind: z.enum(["webhook", "discord", "slack", "telegram", "email"]),
	name: z.string().trim().min(1, "Give the channel a name.").max(100),
	target: z.string().trim().min(1, "Give the channel a destination."),
});

/**
 * Builds the stored `target` from the create form : the `target` field as is,
 * except for Telegram, whose bot token and chat id fields are packed into one.
 */
export function channelTargetFromForm(form: FormData): string {
	if (form.get("kind") !== "telegram") {
		return String(form.get("target") ?? "");
	}
	const botToken = String(form.get("telegramBotToken") ?? "").trim();
	const chatId = String(form.get("telegramChatId") ?? "").trim();
	return botToken || chatId ? formatTelegramTarget({ botToken, chatId }) : "";
}

/**
 * Checks a Telegram target is a bot token (`123456:ABC…`) and a numeric chat
 * id or `@channel` name.
 *
 * @returns An error message, or null when the target is valid.
 */
function validateTelegramTarget(target: string): string | null {
	const parsed = parseTelegramTarget(target);
	if (!(parsed && TELEGRAM_BOT_TOKEN.test(parsed.botToken))) {
		return "A Telegram bot token looks like 123456789:AA… (from @BotFather).";
	}
	return TELEGRAM_CHAT_ID.test(parsed.chatId)
		? null
		: "A Telegram chat id is a number like -1001234567890, or an @channel name.";
}

function isDiscordWebhook(url: URL): boolean {
	return (
		url.protocol === "https:" &&
		DISCORD_HOSTS.has(url.hostname) &&
		url.pathname.startsWith("/api/webhooks/")
	);
}

function isSlackWebhook(url: URL): boolean {
	return (
		url.protocol === "https:" &&
		url.hostname === SLACK_HOST &&
		SLACK_PATHS.some((prefix) => url.pathname.startsWith(prefix))
	);
}

/**
 * Checks a channel's destination fits its kind : an email address, an https
 * Discord or Slack webhook URL, a Telegram bot token and chat id, or any
 * http(s) URL for a plain webhook.
 *
 * @returns An error message, or null when the target is valid.
 */
export function validateChannelTarget(
	kind: NotificationChannelKind,
	target: string,
): string | null {
	if (kind === "telegram") {
		return validateTelegramTarget(target);
	}
	if (kind === "email") {
		return z.string().email().safeParse(target).success
			? null
			: "That doesn't look like an email address.";
	}
	let url: URL;
	try {
		url = new URL(target);
	} catch {
		return "That doesn't look like a URL.";
	}
	if (kind === "discord") {
		return isDiscordWebhook(url)
			? null
			: "A Discord webhook URL looks like https://discord.com/api/webhooks/….";
	}
	if (kind === "slack") {
		return isSlackWebhook(url)
			? null
			: "A Slack webhook URL looks like https://hooks.slack.com/services/….";
	}
	return url.protocol === "http:" || url.protocol === "https:"
		? null
		: "A webhook URL must start with http:// or https://.";
}
