import type { Notification } from "#lib/server/db/schema.js";
import { resolve } from "$app/paths";

const FAILURE_TYPES = new Set<Notification["type"]>([
	"app_runtime_error",
	"build_checks_failed",
	"deploy_failure",
	"deploy_rolled_back",
	"deploy_unhealthy",
	"docker_wedged",
	"error_issue",
	"image_scan_critical",
	"resource_alert",
	"scheduled_failure",
	"update_failed",
]);

/** Whether a notification reports something that went wrong, which the feed marks in red. */
export function isFailureNotification(type: Notification["type"]): boolean {
	return FAILURE_TYPES.has(type);
}

/** Where a notification leads: its service, the Scheduling page for a scheduled tasks summary, or nowhere. */
export function notificationHref(item: {
	serviceId: string | null;
	type: Notification["type"];
}): string | null {
	if (item.serviceId) {
		return resolve("/(protected)/services/[serviceId]", {
			serviceId: item.serviceId,
		});
	}
	if (item.type === "scheduled_summary" || item.type === "scheduled_failure") {
		return resolve("scheduling");
	}
	return null;
}

/** The browser's notification permission, or "unsupported" where the Notification API doesn't exist. */
export function browserNotificationPermission():
	| NotificationPermission
	| "unsupported" {
	return typeof Notification === "undefined"
		? "unsupported"
		: Notification.permission;
}

/**
 * Asks the browser for permission to show notifications.
 *
 * @throws When the browser has no Notification API, or the permission is
 *   denied or dismissed.
 */
export async function requestBrowserNotifications(): Promise<void> {
	if (typeof Notification === "undefined") {
		throw new Error("This browser can't show notifications.");
	}
	const permission = await Notification.requestPermission();
	if (permission !== "granted") {
		throw new Error(
			permission === "denied"
				? "Notifications are blocked for this site. Allow them from the browser's site settings."
				: "Notifications weren't allowed.",
		);
	}
}
