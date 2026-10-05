import {
	and,
	count,
	desc,
	eq,
	inArray,
	isNull,
	lt,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "#lib/server/db/lib.js";
import { type TraceSpan, traceSpan } from "#lib/server/db/schema.js";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
	sortOrder,
} from "#lib/server/list-query.js";
import type { TraceSummary } from "#lib/tracing/waterfall.js";
import { BaseDTO } from "./base-dto";

const INSERT_CHUNK = 1000;
const MAX_SPANS_PER_TRACE = 5000;

/** Whose spans a trace list or page covers: one service's, or Homerun's own (no service). */
export type TraceScope = { serviceId: string } | { instance: true };

export type NewTraceSpan = Omit<TraceSpan, "id">;

function scopeCondition(scope: TraceScope): SQL {
	return "serviceId" in scope
		? eq(traceSpan.serviceId, scope.serviceId)
		: isNull(traceSpan.serviceId);
}

/**
 * Stored OpenTelemetry spans (`trace_span`): what services send through the
 * collector and what the homerun worker writes about its own jobs. A trace
 * is every span sharing a trace id; there's no trace table of its own.
 */
export class TraceSpanDTO extends BaseDTO<TraceSpan> {
	/** Stores spans in bulk, skipping any already stored (same trace and span id), and returns how many were new. */
	static async insertMany(rows: NewTraceSpan[]): Promise<number> {
		let inserted = 0;
		for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
			// oxlint-disable-next-line no-await-in-loop -- chunks keep each insert under Postgres's parameter limit
			const result = await db
				.insert(traceSpan)
				.values(rows.slice(index, index + INSERT_CHUNK))
				.onConflictDoNothing({ target: [traceSpan.traceId, traceSpan.spanId] })
				.returning({ id: traceSpan.id });
			inserted += result.length;
		}
		return inserted;
	}

	/**
	 * One page of traces in `scope`, newest first unless sorted otherwise:
	 * each with its root span's name, its duration from first start to last
	 * end, its span and error counts. `q` matches a span name or a trace id
	 * anywhere in the trace; the `status=error` filter keeps traces with a
	 * failed span.
	 */
	static async listTraces(
		scope: TraceScope,
		query: ListQuery,
	): Promise<PagedResult<TraceSummary>> {
		const conditions: SQL[] = [scopeCondition(scope)];
		const search = searchCondition(query.q, [
			traceSpan.name,
			traceSpan.traceId,
		]);
		if (search) {
			conditions.push(
				inArray(
					traceSpan.traceId,
					db
						.select({ traceId: traceSpan.traceId })
						.from(traceSpan)
						.where(and(scopeCondition(scope), search)),
				),
			);
		}
		const where = and(...conditions);
		const errorCount = sql<number>`count(*) filter (where ${traceSpan.statusCode} = 2)`;
		const having = query.filters.status?.includes("error")
			? sql`${errorCount} > 0`
			: undefined;
		const startTime = sql<Date>`min(${traceSpan.startTime})`.mapWith(
			traceSpan.startTime,
		);
		const durationMs = sql<number>`extract(epoch from (max(${traceSpan.endTime}) - min(${traceSpan.startTime}))) * 1000`;
		const spanCount = count();
		const [rows, totals] = await Promise.all([
			db
				.select({
					durationMs: durationMs.mapWith(Number),
					errorCount: errorCount.mapWith(Number),
					rootName: sql<string>`(array_agg(${traceSpan.name} order by (${traceSpan.parentSpanId} is not null), ${traceSpan.startTime}))[1]`,
					serviceName: sql<string>`(array_agg(${traceSpan.serviceName} order by (${traceSpan.parentSpanId} is not null), ${traceSpan.startTime}))[1]`,
					spanCount,
					startTime,
					traceId: traceSpan.traceId,
				})
				.from(traceSpan)
				.where(where)
				.groupBy(traceSpan.traceId)
				.having(having)
				.orderBy(
					...sortOrder(
						query.sort,
						{ duration: durationMs, spans: spanCount, started: startTime },
						desc(startTime),
					),
				)
				.limit(query.limit)
				.offset(query.offset),
			db
				.select({ total: count() })
				.from(
					db
						.select({ traceId: traceSpan.traceId })
						.from(traceSpan)
						.where(where)
						.groupBy(traceSpan.traceId)
						.having(having)
						.as("traces"),
				),
		]);
		return {
			items: rows,
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/** Whether `traceId` has at least one span in `scope`, the condition for showing it there. */
	static async inScope(scope: TraceScope, traceId: string): Promise<boolean> {
		const [row] = await db
			.select({ id: traceSpan.id })
			.from(traceSpan)
			.where(and(scopeCondition(scope), eq(traceSpan.traceId, traceId)))
			.limit(1);
		return Boolean(row);
	}

	/** Every span of a trace, from every service that took part, in start order (the first 5000). */
	static async spansOf(traceId: string): Promise<TraceSpan[]> {
		return await db
			.select()
			.from(traceSpan)
			.where(eq(traceSpan.traceId, traceId))
			.orderBy(traceSpan.startTime)
			.limit(MAX_SPANS_PER_TRACE);
	}

	/**
	 * Deletes spans that started before `cutoff`, `batchSize` at a time so a
	 * big backlog never holds one long lock, and returns how many went.
	 */
	static async pruneBefore(cutoff: Date, batchSize: number): Promise<number> {
		let deleted = 0;
		for (;;) {
			// oxlint-disable-next-line no-await-in-loop -- batches run one after the other on purpose
			const batch = await db
				.delete(traceSpan)
				.where(
					inArray(
						traceSpan.id,
						db
							.select({ id: traceSpan.id })
							.from(traceSpan)
							.where(lt(traceSpan.startTime, cutoff))
							.limit(batchSize),
					),
				)
				.returning({ id: traceSpan.id });
			deleted += batch.length;
			if (batch.length < batchSize) {
				return deleted;
			}
		}
	}
}
