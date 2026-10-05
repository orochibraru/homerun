import { and, count, desc, eq, gte, lt, max, sql } from "drizzle-orm";
import { db } from "#lib/server/db/lib.js";
import { type BlockedHit, blockedHit } from "#lib/server/db/schema.js";
import { BaseDTO } from "./base-dto";

/** One address's blocked requests within a window, newest first. */
export interface BlockedAddress {
	hits: number;
	host: string | null;
	ip: string;
	lastAt: Date;
	path: string | null;
}

/** Wraps the `blocked_hit` table: one row per request a service's blocked paths turned away, counted towards an IP ban. */
export class BlockedHitDTO extends BaseDTO<BlockedHit> {
	/** Records one blocked request. */
	static async record(input: {
		host: string | null;
		ip: string;
		path: string | null;
	}): Promise<void> {
		await db.insert(blockedHit).values({ ...input, createdAt: new Date() });
	}

	/** How many blocked requests `ip` made since `since`. */
	static async countSince(ip: string, since: Date): Promise<number> {
		const [row] = await db
			.select({ total: count() })
			.from(blockedHit)
			.where(and(eq(blockedHit.ip, ip), gte(blockedHit.createdAt, since)));
		return row?.total ?? 0;
	}

	/** Deletes every hit older than `before`. */
	static async deleteBefore(before: Date): Promise<void> {
		await db.delete(blockedHit).where(lt(blockedHit.createdAt, before));
	}

	/**
	 * Every address with blocked requests since `since`, with how many, when
	 * the last one came and the host and path it asked for, most recent first.
	 */
	static async addressesSince(
		since: Date,
		limit = 100,
	): Promise<BlockedAddress[]> {
		const lastAt = max(blockedHit.createdAt);
		const rows = await db
			.select({
				hits: count(),
				host: sql<
					string | null
				>`(array_agg(${blockedHit.host} order by ${blockedHit.createdAt} desc))[1]`,
				ip: blockedHit.ip,
				lastAt,
				path: sql<
					string | null
				>`(array_agg(${blockedHit.path} order by ${blockedHit.createdAt} desc))[1]`,
			})
			.from(blockedHit)
			.where(gte(blockedHit.createdAt, since))
			.groupBy(blockedHit.ip)
			.orderBy(desc(lastAt))
			.limit(limit);
		return rows.map((row) => ({ ...row, lastAt: row.lastAt ?? since }));
	}
}
