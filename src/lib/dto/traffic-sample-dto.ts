import { and, eq, gte, lt, min, sql } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type TrafficSample, trafficSample } from "$lib/server/db/schema";
import type { TrafficCounters } from "$lib/traffic-metrics";
import { BaseDTO } from "./base-dto";

/** Traffic rows older than this are pruned: a year of history, like the resource samples. */
const RETENTION_MS = 365 * 86_400_000;

/** A service's traffic over a range. */
export interface TrafficTotals {
	avgResponseMs: number | null;
	bytesIn: number;
	bytesOut: number;
	requests: number;
	status4xx: number;
	status5xx: number;
}

/** One chart bucket of traffic. */
export interface TrafficPoint {
	at: Date;
	avgResponseMs: number | null;
	errors: number;
	requests: number;
}

/** The scope a query reads: one service, from `since` on (everything when null). */
function scope(serviceId: string, since: Date | null) {
	return since
		? and(
				eq(trafficSample.serviceId, serviceId),
				gte(trafficSample.createdAt, since),
			)
		: eq(trafficSample.serviceId, serviceId);
}

/**
 * Wraps `traffic_sample`: one row per service per minute it served requests
 * in, the increase of Traefik's request counters over that minute. A minute
 * without requests writes nothing.
 */
export class TrafficSampleDTO extends BaseDTO<TrafficSample> {
	/** Writes one row per service with requests in it, all stamped now. */
	static async recordMany(
		rows: (TrafficCounters & { serviceId: string })[],
	): Promise<void> {
		const busy = rows.filter((row) => row.requests > 0);
		if (busy.length === 0) {
			return;
		}
		const now = new Date();
		await db.insert(trafficSample).values(
			busy.map((row) => ({
				bytesIn: row.bytesIn,
				bytesOut: row.bytesOut,
				createdAt: now,
				durationMs: row.durationSeconds * 1000,
				id: crypto.randomUUID(),
				requests: Math.round(row.requests),
				serviceId: row.serviceId,
				status4xx: Math.round(row.status4xx),
				status5xx: Math.round(row.status5xx),
			})),
		);
	}

	/** Totals and the average response time over a range. */
	static async totals(
		serviceId: string,
		since: Date | null,
	): Promise<TrafficTotals> {
		const [row] = await db
			.select({
				bytesIn: sql<number>`coalesce(sum(${trafficSample.bytesIn}), 0)`,
				bytesOut: sql<number>`coalesce(sum(${trafficSample.bytesOut}), 0)`,
				durationMs: sql<number>`coalesce(sum(${trafficSample.durationMs}), 0)`,
				requests: sql<number>`coalesce(sum(${trafficSample.requests}), 0)`,
				status4xx: sql<number>`coalesce(sum(${trafficSample.status4xx}), 0)`,
				status5xx: sql<number>`coalesce(sum(${trafficSample.status5xx}), 0)`,
			})
			.from(trafficSample)
			.where(scope(serviceId, since));
		const requests = Number(row?.requests ?? 0);
		return {
			avgResponseMs: requests ? Number(row?.durationMs) / requests : null,
			bytesIn: Number(row?.bytesIn ?? 0),
			bytesOut: Number(row?.bytesOut ?? 0),
			requests,
			status4xx: Number(row?.status4xx ?? 0),
			status5xx: Number(row?.status5xx ?? 0),
		};
	}

	/**
	 * Requests, errors (4xx and 5xx) and the average response time per
	 * bucket. `bucketSeconds` comes from `bucketSecondsFor`, a number, never
	 * user input, so it's inlined: Postgres rejects division by an untyped
	 * bind parameter.
	 */
	static async series(
		serviceId: string,
		since: Date | null,
		bucketSeconds: number,
	): Promise<TrafficPoint[]> {
		const bucket = sql<number>`floor(extract(epoch from ${trafficSample.createdAt}) / ${sql.raw(String(Math.trunc(bucketSeconds)))})`;
		const rows = await db
			.select({
				bucket,
				durationMs: sql<number>`sum(${trafficSample.durationMs})`,
				errors: sql<number>`sum(${trafficSample.status4xx} + ${trafficSample.status5xx})`,
				requests: sql<number>`sum(${trafficSample.requests})`,
			})
			.from(trafficSample)
			.where(scope(serviceId, since))
			.groupBy(bucket)
			.orderBy(bucket);
		return rows.map((row) => {
			const requests = Number(row.requests ?? 0);
			return {
				at: new Date(Number(row.bucket) * bucketSeconds * 1000),
				avgResponseMs: requests ? Number(row.durationMs) / requests : null,
				errors: Number(row.errors ?? 0),
				requests,
			};
		});
	}

	/** When a service's first traffic row was written, null when it has none. */
	static async firstAt(serviceId: string): Promise<Date | null> {
		const [row] = await db
			.select({ first: min(trafficSample.createdAt) })
			.from(trafficSample)
			.where(eq(trafficSample.serviceId, serviceId));
		return row?.first ?? null;
	}

	/** Deletes rows past the one-year retention. */
	static async prune(): Promise<void> {
		await db
			.delete(trafficSample)
			.where(lt(trafficSample.createdAt, new Date(Date.now() - RETENTION_MS)));
	}
}
