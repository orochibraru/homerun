import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	type Notification,
	notification,
	service,
} from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export interface NewNotificationInput {
	message: string;
	serviceId?: string | null;
	type: Notification["type"];
	userId: string;
}

// Same amortized-prune convention as AppLogDTO, per user rather than
// instance-wide (each user's own bell feed stays bounded independently).
const MAX_ROWS_PER_USER = 200;
const PRUNE_PROBABILITY = 0.05;

/** Wraps the `notification` table : the bell-icon feed, see schema.ts's docstring on `notification`. */
export class NotificationDTO extends BaseDTO<Notification> {
	/** Most recent notifications for one user, newest first, with the related service's name/slug joined in for the feed to link out to it. */
	static async listForUser(
		userId: string,
		limit = 30,
	): Promise<
		Array<{ notification: NotificationDTO; serviceSlug: string | null }>
	> {
		const rows = await db
			.select({ row: notification, serviceSlug: service.slug })
			.from(notification)
			.leftJoin(service, eq(notification.serviceId, service.id))
			.where(eq(notification.userId, userId))
			.orderBy(desc(notification.createdAt))
			.limit(limit);
		return rows.map((r) => ({
			notification: new NotificationDTO(r.row),
			serviceSlug: r.serviceSlug,
		}));
	}

	static async unreadCount(userId: string): Promise<number> {
		const rows = await db
			.select({ id: notification.id })
			.from(notification)
			.where(and(eq(notification.userId, userId), isNull(notification.readAt)));
		return rows.length;
	}

	/**
	 * Fire-and-forget, same posture as Logger.warn/error's app_log write :
	 * never awaited by the caller, never throws (a failed notification write
	 * shouldn't fail the operation it's notifying about). Call sites use
	 * this directly rather than `new NotificationDTO(...)`, there's no
	 * synchronous constructor path callers need.
	 */
	static notify(input: NewNotificationInput): void {
		NotificationDTO.create(input).catch(() => {
			// Best-effort : see docstring above.
		});
	}

	static async create(input: NewNotificationInput): Promise<NotificationDTO> {
		const row: Notification = {
			createdAt: new Date(),
			id: crypto.randomUUID(),
			message: input.message,
			readAt: null,
			serviceId: input.serviceId ?? null,
			type: input.type,
			userId: input.userId,
		};
		await db.insert(notification).values(row);

		if (Math.random() < PRUNE_PROBABILITY) {
			await NotificationDTO.prune(input.userId);
		}

		return new NotificationDTO(row);
	}

	static async prune(userId: string): Promise<void> {
		const [cutoff] = await db
			.select({ createdAt: notification.createdAt })
			.from(notification)
			.where(eq(notification.userId, userId))
			.orderBy(desc(notification.createdAt))
			.limit(1)
			.offset(MAX_ROWS_PER_USER - 1);
		if (!cutoff) {
			return;
		}
		await db
			.delete(notification)
			.where(
				and(
					eq(notification.userId, userId),
					lt(notification.createdAt, cutoff.createdAt),
				),
			);
	}

	static async markAllRead(userId: string): Promise<void> {
		await db
			.update(notification)
			.set({ readAt: new Date() })
			.where(and(eq(notification.userId, userId), isNull(notification.readAt)));
	}

	static async markRead(id: string, userId: string): Promise<void> {
		await db
			.update(notification)
			.set({ readAt: new Date() })
			.where(and(eq(notification.id, id), eq(notification.userId, userId)));
	}

	/**
	 * Notifies a service's owner of an app-level error attributed to it
	 * (Logger.error()'s "app runtime failures" feed item), looked up by
	 * `serviceId` alone since the logging call site doesn't carry a userId
	 * (see logger.ts's persistLog, same heuristic-attribution shape as
	 * AppLogDTO). The one unscoped-by-owner query in this DTO, same
	 * precedent as ServiceDTO.listCronEnabled : this is internal
	 * system-triggered attribution, not a user-facing access path.
	 */
	static async notifyServiceError(
		serviceId: string,
		message: string,
	): Promise<void> {
		const [row] = await db
			.select({ name: service.name, userId: service.userId })
			.from(service)
			.where(eq(service.id, serviceId))
			.limit(1);
		if (!row) {
			return;
		}
		await NotificationDTO.create({
			message: `"${row.name}" hit a runtime error: ${message}`,
			serviceId,
			type: "app_runtime_error",
			userId: row.userId,
		});
	}
}
