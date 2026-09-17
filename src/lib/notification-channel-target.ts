import type { NotificationChannelKind } from "$lib/types";

export interface TelegramTarget {
	botToken: string;
	chatId: string;
}

/**
 * Packs a Telegram bot token and chat id into the single `target` column a
 * channel row stores.
 */
export function formatTelegramTarget(target: TelegramTarget): string {
	return `${target.botToken.trim()}/${target.chatId.trim()}`;
}

/**
 * Splits a stored Telegram `target` back into its bot token and chat id.
 *
 * @returns Null when the value isn't a `<bot token>/<chat id>` pair.
 */
export function parseTelegramTarget(target: string): TelegramTarget | null {
	const separator = target.lastIndexOf("/");
	if (separator <= 0 || separator === target.length - 1) {
		return null;
	}
	return {
		botToken: target.slice(0, separator),
		chatId: target.slice(separator + 1),
	};
}

/**
 * What the dashboard shows as a channel's destination: the target itself,
 * except a Telegram channel's, which shows only the chat so the bot token
 * never reaches the browser.
 */
export function channelTargetLabel(
	kind: NotificationChannelKind,
	target: string,
): string {
	if (kind !== "telegram") {
		return target;
	}
	const parsed = parseTelegramTarget(target);
	return parsed ? `Chat ${parsed.chatId}` : "Chat unknown";
}
