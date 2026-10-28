import {
	and,
	desc,
	eq,
	gte,
	inArray,
	lt,
	lte,
	type SQL,
	sql,
} from "drizzle-orm";

import {
	encodeCursor,
	type LogHistoryLine,
	type LogHistoryPage,
	type LogHistoryQuery,
} from "#lib/logs/history.js";
import { db } from "#lib/server/db/lib.js";
import { type ServiceLog, serviceLog } from "#lib/server/db/schema.js";
import { searchCondition } from "#lib/server/list-query.js";

import { BaseDTO } from "./base-dto";

/** A Postgres regex that doesn't compile, reported to the caller instead of as a server error. */
export class InvalidLogPatternError extends Error {}

const TIME_TEXT = sql<string>`to_char(${serviceLog.time}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Stored container output (`service_log`): every line the homerun worker's
 * log shipper copied out of a service's containers and swarm tasks, kept
 * across deploys until the retention prunes it.
 */
export class ServiceLogDTO extends BaseDTO<ServiceLog> {
	/**
	 * One page of a service's stored lines matching `query`, newest first,
	 * with the cursor for the page of older lines when there is one.
	 *
	 * @throws InvalidLogPatternError When `query.regex` is set and `q` isn't a
	 *   valid regular expression.
	 */
	static async search(
		serviceId: string,
		query: LogHistoryQuery,
	): Promise<LogHistoryPage> {
		const conditions: SQL[] = [eq(serviceLog.serviceId, serviceId)];
		if (query.q) {
			conditions.push(
				query.regex
					? sql`${serviceLog.line} ~* ${query.q}`
					: (searchCondition(query.q, [serviceLog.line]) as SQL),
			);
		}
		if (query.from) {
			conditions.push(gte(serviceLog.time, query.from));
		}
		if (query.to) {
			conditions.push(lte(serviceLog.time, query.to));
		}
		if (query.deploymentId) {
			conditions.push(eq(serviceLog.deploymentId, query.deploymentId));
		}
		if (query.instance) {
			conditions.push(eq(serviceLog.instance, query.instance));
		}
		if (query.stream) {
			conditions.push(eq(serviceLog.stream, query.stream));
		}
		if (query.before) {
			conditions.push(
				sql`(${serviceLog.time}, ${serviceLog.id}) < (${query.before.time}::timestamp, ${query.before.id})`,
			);
		}
		let rows: (Omit<LogHistoryLine, "time"> & { time: string })[];
		try {
			rows = await db
				.select({
					deploymentId: serviceLog.deploymentId,
					id: serviceLog.id,
					instance: serviceLog.instance,
					line: serviceLog.line,
					stream: serviceLog.stream,
					time: TIME_TEXT,
				})
				.from(serviceLog)
				.where(and(...conditions))
				.orderBy(desc(serviceLog.time), desc(serviceLog.id))
				.limit(query.limit + 1);
		} catch (error) {
			if (
				query.regex &&
				/regular expression/i.test(
					`${error} ${error instanceof Error ? error.cause : ""}`,
				)
			) {
				throw new InvalidLogPatternError(
					`That isn't a valid regular expression: ${query.q}`,
				);
			}
			throw error;
		}
		const lines = rows.slice(0, query.limit);
		const last = lines.at(-1);
		return {
			lines,
			nextCursor:
				rows.length > query.limit && last
					? encodeCursor({ id: last.id, time: last.time })
					: null,
		};
	}

	/** Which of a service's instances (containers or swarm tasks) have stored lines, most recent first. */
	static async instances(serviceId: string): Promise<string[]> {
		const rows = await db
			.select({ instance: serviceLog.instance })
			.from(serviceLog)
			.where(eq(serviceLog.serviceId, serviceId))
			.groupBy(serviceLog.instance)
			.orderBy(desc(sql`max(${serviceLog.time})`))
			.limit(50);
		return rows.map((row) => row.instance);
	}

	/** The oldest stored line's time for a service, null when nothing is stored. */
	static async oldest(serviceId: string): Promise<Date | null> {
		const [row] = await db
			.select({ time: sql<Date | null>`min(${serviceLog.time})` })
			.from(serviceLog)
			.where(eq(serviceLog.serviceId, serviceId));
		return row?.time ? new Date(row.time) : null;
	}

	/** Deletes lines older than `cutoff`, `batchSize` at a time, and returns how many went. */
	static async pruneBefore(cutoff: Date, batchSize: number): Promise<number> {
		let deleted = 0;
		for (;;) {
			// oxlint-disable-next-line no-await-in-loop -- batches run one after the other on purpose
			const batch = await db
				.delete(serviceLog)
				.where(
					inArray(
						serviceLog.id,
						db
							.select({ id: serviceLog.id })
							.from(serviceLog)
							.where(lt(serviceLog.time, cutoff))
							.limit(batchSize),
					),
				)
				.returning({ id: serviceLog.id });
			deleted += batch.length;
			if (batch.length < batchSize) {
				return deleted;
			}
		}
	}
}
