import { z } from "zod";
import {
	MAX_ROWS_PER_USER,
	NotificationDTO,
} from "#lib/dto/notification-dto.js";
import type { Notification } from "#lib/server/db/schema.js";
import { requireUser } from "#lib/server/remote-auth.js";
import { command, query } from "$app/server";

const UNREAD_PREVIEW_LIMIT = 5;

export interface NotificationFeedItem {
	createdAt: Date;
	detail: string | null;
	id: string;
	message: string;
	readAt: Date | null;
	serviceId: string | null;
	stackName: string | null;
	type: Notification["type"];
}

export interface NotificationFeed {
	items: NotificationFeedItem[];
	unreadCount: number;
}

/** The signed-in user's notifications as feed items, newest first. */
async function feedItems(
	userId: string,
	limit: number,
	unreadOnly: boolean,
): Promise<NotificationFeedItem[]> {
	const rows = await NotificationDTO.listForUser(userId, limit, unreadOnly);
	return rows.map(({ notification, stackName }) => {
		const row = notification.toJSON();
		return {
			createdAt: row.createdAt,
			detail: row.detail,
			id: row.id,
			message: row.message,
			readAt: row.readAt,
			serviceId: row.serviceId,
			stackName,
			type: row.type,
		};
	});
}

export const getNotifications = query(async (): Promise<NotificationFeed> => {
	const user = requireUser();
	const [items, unreadCount] = await Promise.all([
		feedItems(user.id, MAX_ROWS_PER_USER, false),
		NotificationDTO.unreadCount(user.id),
	]);
	return { items, unreadCount };
});

export const getUnreadNotifications = query(
	async (): Promise<NotificationFeed> => {
		const user = requireUser();
		const [items, unreadCount] = await Promise.all([
			feedItems(user.id, UNREAD_PREVIEW_LIMIT, true),
			NotificationDTO.unreadCount(user.id),
		]);
		return { items, unreadCount };
	},
);

/** Refreshes both feeds after a mutation, so the page, the bell and the dashboard agree. */
async function refreshFeeds(): Promise<void> {
	await Promise.all([
		getNotifications().refresh(),
		getUnreadNotifications().refresh(),
	]);
}

export const markNotificationRead = command(z.string(), async (id) => {
	const user = requireUser();
	await NotificationDTO.markRead(id, user.id);
	await refreshFeeds();
});

export const markAllNotificationsRead = command(async () => {
	const user = requireUser();
	await NotificationDTO.markAllRead(user.id);
	await refreshFeeds();
});

export const deleteNotification = command(z.string(), async (id) => {
	const user = requireUser();
	await NotificationDTO.delete(id, user.id);
	await refreshFeeds();
});

export const deleteAllNotifications = command(async () => {
	const user = requireUser();
	await NotificationDTO.deleteAll(user.id);
	await refreshFeeds();
});
