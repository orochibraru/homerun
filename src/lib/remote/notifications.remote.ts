import { z } from "zod";
import { command, query } from "$app/server";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { requireUser } from "$lib/server/remote-auth";

const NOTIFICATION_LIMIT = 20;

export interface NotificationFeedItem {
	createdAt: Date;
	id: string;
	message: string;
	readAt: Date | null;
	serviceId: string | null;
}

export interface NotificationFeed {
	items: NotificationFeedItem[];
	unreadCount: number;
}

export const getNotifications = query(async (): Promise<NotificationFeed> => {
	const user = requireUser();
	const [rows, unreadCount] = await Promise.all([
		NotificationDTO.listForUser(user.id, NOTIFICATION_LIMIT),
		NotificationDTO.unreadCount(user.id),
	]);
	return {
		items: rows.map(({ notification }) => {
			const row = notification.toJSON();
			return {
				createdAt: row.createdAt,
				id: row.id,
				message: row.message,
				readAt: row.readAt,
				serviceId: row.serviceId,
			};
		}),
		unreadCount,
	};
});

export const markNotificationRead = command(z.string(), async (id) => {
	const user = requireUser();
	await NotificationDTO.markRead(id, user.id);
	await getNotifications().refresh();
});

export const markAllNotificationsRead = command(async () => {
	const user = requireUser();
	await NotificationDTO.markAllRead(user.id);
	await getNotifications().refresh();
});

export const deleteNotification = command(z.string(), async (id) => {
	const user = requireUser();
	await NotificationDTO.delete(id, user.id);
	await getNotifications().refresh();
});
