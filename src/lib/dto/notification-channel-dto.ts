import { and, asc, eq } from "drizzle-orm";
import { DEFAULT_NOTIFICATION_EVENTS } from "$lib/notification-events";
import { db } from "$lib/server/db/lib";
import {
	type NotificationChannel,
	notificationChannel,
} from "$lib/server/db/schema";
import { searchCondition } from "$lib/server/list-query";
import type { NotificationChannelKind, NotificationEvent } from "$lib/types";
import { BaseDTO } from "./base-dto";

export interface NewNotificationChannelInput {
	enabled?: boolean;
	events?: NotificationEvent[];
	kind: NotificationChannelKind;
	name: string;
	target: string;
	userId: string;
}

export type NotificationChannelUpdateInput = Partial<
	Pick<
		NotificationChannel,
		"enabled" | "events" | "kind" | "lastError" | "name" | "target"
	>
>;

export class NotificationChannelDTO extends BaseDTO<NotificationChannel> {
	static async get(
		id: string,
		userId: string,
	): Promise<NotificationChannelDTO | null> {
		const [row] = await db
			.select()
			.from(notificationChannel)
			.where(
				and(
					eq(notificationChannel.id, id),
					eq(notificationChannel.userId, userId),
				),
			)
			.limit(1);
		return row ? new NotificationChannelDTO(row) : null;
	}

	static async list(userId: string): Promise<NotificationChannelDTO[]> {
		const rows = await db
			.select()
			.from(notificationChannel)
			.where(eq(notificationChannel.userId, userId))
			.orderBy(asc(notificationChannel.name));
		return rows.map((row) => new NotificationChannelDTO(row));
	}

	static async listSubscribed(
		userId: string,
		event: NotificationEvent,
	): Promise<NotificationChannelDTO[]> {
		const rows = await db
			.select()
			.from(notificationChannel)
			.where(
				and(
					eq(notificationChannel.userId, userId),
					eq(notificationChannel.enabled, true),
				),
			)
			.orderBy(asc(notificationChannel.name));
		return rows
			.filter((row) => row.events.includes(event))
			.map((row) => new NotificationChannelDTO(row));
	}

	static async search(
		userId: string,
		q: string,
		limit: number,
	): Promise<NotificationChannelDTO[]> {
		const rows = await db
			.select()
			.from(notificationChannel)
			.where(
				and(
					eq(notificationChannel.userId, userId),
					searchCondition(q, [
						notificationChannel.name,
						notificationChannel.kind,
					]),
				),
			)
			.orderBy(asc(notificationChannel.name))
			.limit(limit);
		return rows.map((row) => new NotificationChannelDTO(row));
	}

	static async create(
		input: NewNotificationChannelInput,
	): Promise<NotificationChannelDTO> {
		const now = new Date();
		const row: NotificationChannel = {
			createdAt: now,
			enabled: input.enabled ?? true,
			events: input.events ?? [...DEFAULT_NOTIFICATION_EVENTS],
			id: crypto.randomUUID(),
			kind: input.kind,
			lastError: null,
			name: input.name,
			target: input.target,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(notificationChannel).values(row);
		return new NotificationChannelDTO(row);
	}

	async update(input: NotificationChannelUpdateInput): Promise<void> {
		await db
			.update(notificationChannel)
			.set(input)
			.where(eq(notificationChannel.id, this.row.id));
		Object.assign(this.row, input);
	}

	async delete(): Promise<void> {
		await db
			.delete(notificationChannel)
			.where(eq(notificationChannel.id, this.row.id));
	}

	get id(): string {
		return this.row.id;
	}
	get events(): NotificationEvent[] {
		return this.row.events;
	}
	get kind(): NotificationChannelKind {
		return this.row.kind;
	}
	get name(): string {
		return this.row.name;
	}
	get target(): string {
		return this.row.target;
	}
}
