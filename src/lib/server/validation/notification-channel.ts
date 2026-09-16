import { z } from "zod";
import type { NotificationChannelKind } from "$lib/types";

const DISCORD_HOSTS = new Set([
	"discord.com",
	"discordapp.com",
	"canary.discord.com",
	"ptb.discord.com",
]);

export const notificationChannelSchema = z.object({
	kind: z.enum(["webhook", "discord", "email"]),
	name: z.string().trim().min(1, "Give the channel a name.").max(100),
	target: z.string().trim().min(1, "Give the channel a destination."),
});

export function validateChannelTarget(
	kind: NotificationChannelKind,
	target: string,
): string | null {
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
		return url.protocol === "https:" &&
			DISCORD_HOSTS.has(url.hostname) &&
			url.pathname.startsWith("/api/webhooks/")
			? null
			: "A Discord webhook URL looks like https://discord.com/api/webhooks/….";
	}
	return url.protocol === "http:" || url.protocol === "https:"
		? null
		: "A webhook URL must start with http:// or https://.";
}
