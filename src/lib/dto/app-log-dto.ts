import { desc, eq, lt } from "drizzle-orm";
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

// Amortized retention cap — rather than a scheduled prune job for what's
// meant to be a lightweight best-effort log, `create()` deletes anything
// past this count on a small fraction of writes (see below). Keeps the
// table bounded without adding a third scheduler alongside CronService's
// two.
const MAX_ROWS = 5000;
const PRUNE_PROBABILITY = 0.02;

/** Wraps the `app_log` table — persisted warn/error-level Logger output, see schema.ts's docstring on `appLog`. */
export class AppLogDTO extends BaseDTO<AppLog> {
	/** Most recent warn/error logs attributable to one service (see schema.ts on how serviceId gets populated) — for that service's Errors tab. */
	static async listForService(
		serviceId: string,
		limit = 50,
	): Promise<AppLogDTO[]> {
		const rows = await db
			.select()
			.from(appLog)
			.where(eq(appLog.serviceId, serviceId))
			.orderBy(desc(appLog.createdAt))
			.limit(limit);
		return rows.map((row) => new AppLogDTO(row));
	}

	/** Most recent warn/error logs instance-wide, regardless of service attribution — for a future instance-wide log view. */
	static async listRecent(limit = 100): Promise<AppLogDTO[]> {
		const rows = await db
			.select()
			.from(appLog)
			.orderBy(desc(appLog.createdAt))
			.limit(limit);
		return rows.map((row) => new AppLogDTO(row));
	}

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

	get id(): string {
		return this.row.id;
	}
	get level(): AppLog["level"] {
		return this.row.level;
	}
	get scope(): string | null {
		return this.row.scope;
	}
	get message(): string {
		return this.row.message;
	}
	get metadata(): string | null {
		return this.row.metadata;
	}
	get createdAt(): Date {
		return this.row.createdAt;
	}
}
