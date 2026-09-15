import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { service, type UptimeCheck, uptimeCheck } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export type ProbeKind = "internal" | "external";

export interface ProbeResult {
	detail?: string | null;
	kind: ProbeKind;
	latencyMs?: number | null;
	ok: boolean;
	serviceId: string;
	target?: string | null;
}

/** How many beats the heartbeat strip draws, and therefore how many are read back. */
export const BEAT_WINDOW = 40;

/** A week at one beat a minute is ~10k rows per service per probe. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Wraps `uptime_check` : the appended liveness history behind the heartbeat strips, see schema.ts. */
export class UptimeCheckDTO extends BaseDTO<UptimeCheck> {
	static async record(result: ProbeResult): Promise<void> {
		await db.insert(uptimeCheck).values({
			checkedAt: new Date(),
			detail: result.detail ?? null,
			id: crypto.randomUUID(),
			kind: result.kind,
			latencyMs: result.latencyMs ?? null,
			ok: result.ok,
			serviceId: result.serviceId,
			target: result.target ?? null,
		});
	}

	static async recordMany(results: ProbeResult[]): Promise<void> {
		if (results.length === 0) {
			return;
		}
		const now = new Date();
		await db.insert(uptimeCheck).values(
			results.map((result) => ({
				checkedAt: now,
				detail: result.detail ?? null,
				id: crypto.randomUUID(),
				kind: result.kind,
				latencyMs: result.latencyMs ?? null,
				ok: result.ok,
				serviceId: result.serviceId,
				target: result.target ?? null,
			})),
		);
	}

	/**
	 * The last `BEAT_WINDOW` beats of one probe, oldest first so the strip
	 * reads left-to-right like every other heartbeat display.
	 */
	static async beats(
		serviceId: string,
		kind: ProbeKind,
		limit = BEAT_WINDOW,
	): Promise<UptimeCheck[]> {
		const rows = await db
			.select()
			.from(uptimeCheck)
			.where(
				and(eq(uptimeCheck.serviceId, serviceId), eq(uptimeCheck.kind, kind)),
			)
			.orderBy(desc(uptimeCheck.checkedAt))
			.limit(limit);
		return rows.reverse();
	}

	/** The newest beat of every probe a user owns, for the dashboard's failing-probe banner. */
	static async latestForUser(userId: string): Promise<UptimeCheck[]> {
		const owned = await db
			.select({ id: service.id })
			.from(service)
			.where(eq(service.userId, userId));
		if (owned.length === 0) {
			return [];
		}
		return await db
			.selectDistinctOn([uptimeCheck.serviceId, uptimeCheck.kind])
			.from(uptimeCheck)
			.where(
				inArray(
					uptimeCheck.serviceId,
					owned.map((row) => row.id),
				),
			)
			.orderBy(
				uptimeCheck.serviceId,
				uptimeCheck.kind,
				desc(uptimeCheck.checkedAt),
			);
	}

	static async latestByProbe(
		serviceIds: string[],
	): Promise<Map<string, UptimeCheck>> {
		if (serviceIds.length === 0) {
			return new Map();
		}
		const rows = await db
			.selectDistinctOn([uptimeCheck.serviceId, uptimeCheck.kind])
			.from(uptimeCheck)
			.where(inArray(uptimeCheck.serviceId, serviceIds))
			.orderBy(
				uptimeCheck.serviceId,
				uptimeCheck.kind,
				desc(uptimeCheck.checkedAt),
			);
		return new Map(rows.map((row) => [`${row.serviceId}:${row.kind}`, row]));
	}

	static async clearForService(serviceId: string): Promise<void> {
		await db.delete(uptimeCheck).where(eq(uptimeCheck.serviceId, serviceId));
	}

	static async prune(): Promise<void> {
		await db
			.delete(uptimeCheck)
			.where(lt(uptimeCheck.checkedAt, new Date(Date.now() - RETENTION_MS)));
	}
}
