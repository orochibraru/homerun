import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	type NotificationChannel,
	notificationChannel,
} from "$lib/server/db/schema";
import type { NotificationChannelKind } from "$lib/types";
import { BaseDTO } from "./base-dto";

export interface NewNotificationChannelInput {
	enabled?: boolean;
	kind: NotificationChannelKind;
	name: string;
	statusPageId?: string | null;
	target: string;
	userId: string;
}

export type NotificationChannelUpdateInput = Partial<
	Pick<
		NotificationChannel,
		"enabled" | "kind" | "lastError" | "name" | "statusPageId" | "target"
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

	static async listForStatusPage(
		userId: string,
		statusPageId: string,
	): Promise<NotificationChannelDTO[]> {
		const rows = await db
			.select()
			.from(notificationChannel)
			.where(
				and(
					eq(notificationChannel.userId, userId),
					eq(notificationChannel.enabled, true),
					or(
						isNull(notificationChannel.statusPageId),
						eq(notificationChannel.statusPageId, statusPageId),
					),
				),
			)
			.orderBy(asc(notificationChannel.name));
		return rows.map((row) => new NotificationChannelDTO(row));
	}

	static async create(
		input: NewNotificationChannelInput,
	): Promise<NotificationChannelDTO> {
		const now = new Date();
		const row: NotificationChannel = {
			createdAt: now,
			enabled: input.enabled ?? true,
			id: crypto.randomUUID(),
			kind: input.kind,
			lastError: null,
			name: input.name,
			statusPageId: input.statusPageId ?? null,
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
