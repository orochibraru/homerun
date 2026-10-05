import { and, count, eq, gte, lt } from "drizzle-orm";
import { db } from "#lib/server/db/lib.js";
import { type BlockedHit, blockedHit } from "#lib/server/db/schema.js";
import { BaseDTO } from "./base-dto";

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
}
