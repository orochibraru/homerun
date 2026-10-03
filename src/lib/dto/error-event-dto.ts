import { and, asc, desc, eq, gt, lt, notInArray, or } from "drizzle-orm";
import { type StoredErrorEvent, userKeyOf } from "#lib/error-tracking/event.js";
import { db } from "#lib/server/db/lib.js";
import { type ErrorEvent, errorEvent } from "#lib/server/db/schema.js";
import { BaseDTO } from "./base-dto";

export interface EventNeighbours {
	newer: string | null;
	older: string | null;
	total: number;
}

/** Wraps `error_event`: one occurrence of an issue, with its trimmed payload. */
export class ErrorEventDTO extends BaseDTO<ErrorEvent> {
	get id(): string {
		return this.row.id;
	}

	/** Whether a service already stored an event with this SDK event id, so a retried send isn't counted twice. */
	static async exists(serviceId: string, eventId: string): Promise<boolean> {
		const [row] = await db
			.select({ id: errorEvent.id })
			.from(errorEvent)
			.where(
				and(
					eq(errorEvent.serviceId, serviceId),
					eq(errorEvent.eventId, eventId),
				),
			)
			.limit(1);
		return !!row;
	}

	/** Stores one event of an issue; a duplicate SDK event id is silently skipped. */
	static async create(
		issueId: string,
		serviceId: string,
		event: StoredErrorEvent,
		receivedAt: Date,
	): Promise<void> {
		await db
			.insert(errorEvent)
			.values({
				environment: event.environment,
				eventId: event.eventId,
				id: crypto.randomUUID(),
				issueId,
				level: event.level,
				message: event.message,
				payload: event,
				receivedAt,
				release: event.release,
				serviceId,
				timestamp: new Date(event.timestamp),
				userKey: userKeyOf(event),
			})
			.onConflictDoNothing();
	}

	/** One event of an issue by id, or its newest when `id` is null. */
	static async getForIssue(
		issueId: string,
		id: string | null,
	): Promise<ErrorEventDTO | null> {
		const [row] = await db
			.select()
			.from(errorEvent)
			.where(
				id
					? and(eq(errorEvent.issueId, issueId), eq(errorEvent.id, id))
					: eq(errorEvent.issueId, issueId),
			)
			.orderBy(desc(errorEvent.receivedAt), desc(errorEvent.id))
			.limit(1);
		return row ? new ErrorEventDTO(row) : null;
	}

	/** The ids of the events either side of this one in its issue, and how many the issue retains. */
	async neighbours(): Promise<EventNeighbours> {
		const { id, issueId, receivedAt } = this.row;
		const after = or(
			gt(errorEvent.receivedAt, receivedAt),
			and(eq(errorEvent.receivedAt, receivedAt), gt(errorEvent.id, id)),
		);
		const before = or(
			lt(errorEvent.receivedAt, receivedAt),
			and(eq(errorEvent.receivedAt, receivedAt), lt(errorEvent.id, id)),
		);
		const [newer, older, total] = await Promise.all([
			db
				.select({ id: errorEvent.id })
				.from(errorEvent)
				.where(and(eq(errorEvent.issueId, issueId), after))
				.orderBy(asc(errorEvent.receivedAt), asc(errorEvent.id))
				.limit(1),
			db
				.select({ id: errorEvent.id })
				.from(errorEvent)
				.where(and(eq(errorEvent.issueId, issueId), before))
				.orderBy(desc(errorEvent.receivedAt), desc(errorEvent.id))
				.limit(1),
			db.$count(errorEvent, eq(errorEvent.issueId, issueId)),
		]);
		return {
			newer: newer[0]?.id ?? null,
			older: older[0]?.id ?? null,
			total,
		};
	}

	/** Deletes all but an issue's newest `keep` events. */
	static async pruneIssue(issueId: string, keep: number): Promise<void> {
		const newest = db
			.select({ id: errorEvent.id })
			.from(errorEvent)
			.where(eq(errorEvent.issueId, issueId))
			.orderBy(desc(errorEvent.receivedAt))
			.limit(keep);
		await db
			.delete(errorEvent)
			.where(
				and(eq(errorEvent.issueId, issueId), notInArray(errorEvent.id, newest)),
			);
	}

	/** Deletes every event received before `before`. */
	static async pruneOlderThan(before: Date): Promise<void> {
		await db.delete(errorEvent).where(lt(errorEvent.receivedAt, before));
	}
}
