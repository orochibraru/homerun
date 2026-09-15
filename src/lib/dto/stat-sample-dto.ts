import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type StatSample, statSample } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export type StatRange =
	| "live"
	| "hour"
	| "day"
	| "week"
	| "month"
	| "year"
	| "all";

export interface StatPoint {
	at: Date;
	cpuPercent: number;
	memUsedMb: number;
	netRxBytesPerSec: number;
	netTxBytesPerSec: number;
}

export interface NewStatSampleInput {
	cpuPercent: number;
	diskUsedGb?: number | null;
	memLimitMb?: number | null;
	memUsedMb: number;
	netRxBytes?: number | null;
	netTxBytes?: number | null;
	serviceId: string | null;
}

/**
 * How far back each range looks and how wide one bucket is. The point count
 * per range stays in the 60-360 band on purpose : enough resolution for the
 * chart's width, few enough rows to aggregate without paging.
 */
const RANGES: Record<
	StatRange,
	{ bucketSeconds: number; windowSeconds: number | null }
> = {
	all: { bucketSeconds: 86_400, windowSeconds: null },
	day: { bucketSeconds: 300, windowSeconds: 86_400 },
	hour: { bucketSeconds: 60, windowSeconds: 3600 },
	live: { bucketSeconds: 60, windowSeconds: 900 },
	month: { bucketSeconds: 7200, windowSeconds: 2_592_000 },
	week: { bucketSeconds: 1800, windowSeconds: 604_800 },
	year: { bucketSeconds: 86_400, windowSeconds: 31_536_000 },
};

/** Samples older than this are pruned by the sampler : a year of minute samples is the retention ceiling. */
const RETENTION_SECONDS = 31_536_000;

/** Wraps `stat_sample` : the resource history behind the dashboard's and a service's own graphs. */
export class StatSampleDTO extends BaseDTO<StatSample> {
	static async record(input: NewStatSampleInput): Promise<void> {
		await db.insert(statSample).values({
			cpuPercent: input.cpuPercent,
			createdAt: new Date(),
			diskUsedGb: input.diskUsedGb ?? null,
			id: crypto.randomUUID(),
			memLimitMb: input.memLimitMb ?? null,
			memUsedMb: input.memUsedMb,
			netRxBytes: input.netRxBytes ?? null,
			netTxBytes: input.netTxBytes ?? null,
			serviceId: input.serviceId,
		});
	}

	static async recordMany(inputs: NewStatSampleInput[]): Promise<void> {
		if (inputs.length === 0) {
			return;
		}
		const now = new Date();
		await db.insert(statSample).values(
			inputs.map((input) => ({
				cpuPercent: input.cpuPercent,
				createdAt: now,
				diskUsedGb: input.diskUsedGb ?? null,
				id: crypto.randomUUID(),
				memLimitMb: input.memLimitMb ?? null,
				memUsedMb: input.memUsedMb,
				netRxBytes: input.netRxBytes ?? null,
				netTxBytes: input.netTxBytes ?? null,
				serviceId: input.serviceId,
			})),
		);
	}

	/**
	 * One bucketed series for a range, averaging CPU/memory per bucket and
	 * turning the cumulative network counters into a per-second rate across
	 * it. The rate is clamped at zero because a container restart resets its
	 * own counters, which would otherwise read as a large negative spike.
	 */
	static async history(
		range: StatRange,
		serviceId: string | null,
	): Promise<StatPoint[]> {
		const { bucketSeconds, windowSeconds } = RANGES[range];
		const scope = serviceId
			? eq(statSample.serviceId, serviceId)
			: isNull(statSample.serviceId);
		const where = windowSeconds
			? and(
					scope,
					gte(
						statSample.createdAt,
						new Date(Date.now() - windowSeconds * 1000),
					),
				)
			: scope;

		// The bucket width is inlined rather than bound: dividing by an
		// untyped bind parameter makes Postgres reject the expression as an
		// ambiguous operator. It's a constant from RANGES above, never user
		// input, so sql.raw is safe here.
		const bucket = sql<number>`floor(extract(epoch from ${statSample.createdAt}) / ${sql.raw(String(bucketSeconds))})`;
		const rows = await db
			.select({
				at: sql<number>`min(extract(epoch from ${statSample.createdAt}))`,
				bucket,
				cpuPercent: sql<number>`avg(${statSample.cpuPercent})`,
				memUsedMb: sql<number>`avg(${statSample.memUsedMb})`,
				rxRange: sql<number>`max(${statSample.netRxBytes}) - min(${statSample.netRxBytes})`,
				spanSeconds: sql<number>`greatest(extract(epoch from (max(${statSample.createdAt}) - min(${statSample.createdAt}))), 1)`,
				txRange: sql<number>`max(${statSample.netTxBytes}) - min(${statSample.netTxBytes})`,
			})
			.from(statSample)
			.where(where)
			.groupBy(bucket)
			.orderBy(bucket);

		return rows.map((row) => ({
			at: new Date(Number(row.at) * 1000),
			cpuPercent: Number(row.cpuPercent ?? 0),
			memUsedMb: Number(row.memUsedMb ?? 0),
			netRxBytesPerSec:
				Math.max(0, Number(row.rxRange ?? 0)) / Number(row.spanSeconds),
			netTxBytesPerSec:
				Math.max(0, Number(row.txRange ?? 0)) / Number(row.spanSeconds),
		}));
	}

	/** The newest sample for every service that has one, for the dashboard's sortable usage table. */
	static async latestPerService(): Promise<Map<string, StatSample>> {
		const rows = await db
			.selectDistinctOn([statSample.serviceId])
			.from(statSample)
			.where(sql`${statSample.serviceId} is not null`)
			.orderBy(statSample.serviceId, desc(statSample.createdAt));
		return new Map(
			rows
				.filter((row) => row.serviceId)
				.map((row) => [row.serviceId as string, row]),
		);
	}

	static async prune(): Promise<void> {
		await db
			.delete(statSample)
			.where(
				lt(
					statSample.createdAt,
					new Date(Date.now() - RETENTION_SECONDS * 1000),
				),
			);
	}
}
