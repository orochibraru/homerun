import { and, count, desc, eq, gt, inArray, lt, lte } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type AppLog, appLog } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export interface NewAppLogInput {
	level: AppLog["level"];
	message: string;
	metadata?: string | null;
	scope?: string | null;
	serviceId?: string | null;
}

// Amortized retention cap : rather than a scheduled prune job for what's
// meant to be a lightweight best-effort log, `create()` deletes anything
// past this count on a small fraction of writes (see below). Keeps the
// table bounded without adding a third scheduler alongside CronService's
// two.
const MAX_ROWS = 5000;
const PRUNE_PROBABILITY = 0.02;

/** Wraps the `app_log` table : persisted warn/error-level Logger output, see schema.ts's docstring on `appLog`. */
export class AppLogDTO extends BaseDTO<AppLog> {
	/** Most recent warn/error logs attributable to one service (see schema.ts on how serviceId gets populated) : for that service's Errors tab. */
	static async listForService(
		serviceId: string,
		limit = 50,
		since: Date | null = null,
	): Promise<AppLogDTO[]> {
		const rows = await db
			.select()
			.from(appLog)
			.where(
				since
					? and(eq(appLog.serviceId, serviceId), gt(appLog.createdAt, since))
					: eq(appLog.serviceId, serviceId),
			)
			.orderBy(desc(appLog.createdAt))
			.limit(limit);
		return rows.map((row) => new AppLogDTO(row));
	}

	/**
	 * Counts one service's logged warn/error entries written at or before
	 * `until`, so the Errors tab can say how many entries a dismissal is hiding.
	 */
	static async countForServiceUpTo(
		serviceId: string,
		until: Date,
	): Promise<number> {
		const [row] = await db
			.select({ total: count() })
			.from(appLog)
			.where(
				and(eq(appLog.serviceId, serviceId), lte(appLog.createdAt, until)),
			);
		return row?.total ?? 0;
	}

	/**
	 * The most recent warn/error logs attributed to any of `serviceIds`, for a
	 * non-admin's dashboard, which must not show other people's services or
	 * instance-level logs.
	 */
	static async listRecentForServices(
		serviceIds: string[],
		limit = 100,
	): Promise<AppLogDTO[]> {
		if (serviceIds.length === 0) {
			return [];
		}
		const rows = await db
			.select()
			.from(appLog)
			.where(inArray(appLog.serviceId, serviceIds))
			.orderBy(desc(appLog.createdAt))
			.limit(limit);
		return rows.map((row) => new AppLogDTO(row));
	}

	/** Most recent warn/error logs instance-wide, regardless of service attribution : for a future instance-wide log view. */
	static async listRecent(limit = 100): Promise<AppLogDTO[]> {
		const rows = await db
			.select()
			.from(appLog)
			.orderBy(desc(appLog.createdAt))
			.limit(limit);
		return rows.map((row) => new AppLogDTO(row));
	}

	/**
	 * Inserts one log entry and, on roughly 2% of writes, prunes the table back
	 * down to its newest 5000 rows.
	 */
	static async create(input: NewAppLogInput): Promise<AppLogDTO> {
		const row: AppLog = {
			createdAt: new Date(),
			id: crypto.randomUUID(),
			level: input.level,
			message: input.message,
			metadata: input.metadata ?? null,
			scope: input.scope ?? null,
			serviceId: input.serviceId ?? null,
		};
		await db.insert(appLog).values(row);

		if (Math.random() < PRUNE_PROBABILITY) {
			await AppLogDTO.prune();
		}

		return new AppLogDTO(row);
	}

	/** Deletes everything past the newest MAX_ROWS entries. */
	static async prune(): Promise<void> {
		const [cutoff] = await db
			.select({ createdAt: appLog.createdAt })
			.from(appLog)
			.orderBy(desc(appLog.createdAt))
			.limit(1)
			.offset(MAX_ROWS - 1);
		if (!cutoff) {
			return;
		}
		await db.delete(appLog).where(lt(appLog.createdAt, cutoff.createdAt));
	}

	/** The log entry's id. */
	get id(): string {
		return this.row.id;
	}
	/** The severity the entry was logged at. */
	get level(): AppLog["level"] {
		return this.row.level;
	}
	/** The Logger scope that wrote the entry, if any. */
	get scope(): string | null {
		return this.row.scope;
	}
	/** The logged message text. */
	get message(): string {
		return this.row.message;
	}
	/** Serialized structured metadata attached to the entry, if any. */
	get metadata(): string | null {
		return this.row.metadata;
	}
	/** When the entry was written. */
	get createdAt(): Date {
		return this.row.createdAt;
	}
}
