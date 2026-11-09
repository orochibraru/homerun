import {
	and,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
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

/** A Postgres regex for a line that reports an error: the word error, fatal, panic, exception or critical, ANSI-coloured or not. */
export const LOG_ERROR_PATTERN =
	"(^|[^[:alnum:]_]|\\[[0-9;]*m)(error|fatal|panic|exception|critical)([^[:alnum:]_]|$)";

/** Whose stored lines to read: a service's, a workstation's, or one of Homerun's own containers' by the name the log shipper files it under (its compose service, else its `homerun.core` label, else its container name). */
export type LogOwner =
	{ serviceId: string } | { system: string } | { workstationId: string };

/** The condition matching `owner`'s lines. */
function ownerCondition(owner: LogOwner): SQL {
	if ("serviceId" in owner) {
		return eq(serviceLog.serviceId, owner.serviceId);
	}
	if ("workstationId" in owner) {
		return eq(serviceLog.workstationId, owner.workstationId);
	}
	return eq(serviceLog.system, owner.system);
}

const TIME_TEXT = sql<string>`to_char(${serviceLog.time}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Stored container output (`service_log`): every line the homerun worker's
 * log shipper copied out of a service's containers and swarm tasks, a
 * workstation's container or one of Homerun's own containers, kept across
 * deploys and recreates until the retention prunes it.
 */
export class ServiceLogDTO extends BaseDTO<ServiceLog> {
	/**
	 * One page of `owner`'s stored lines matching `query`, newest first,
	 * with the cursor for the page of older lines when there is one.
	 *
	 * @throws InvalidLogPatternError When `query.regex` is set and `q` isn't a
	 *   valid regular expression.
	 */
	static async search(
		owner: LogOwner,
		query: LogHistoryQuery,
	): Promise<LogHistoryPage> {
		const conditions: SQL[] = [ownerCondition(owner)];
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

	/**
	 * A service's stored lines since `since`, counted per bucket of
	 * `bucketSeconds` (each `bucket` being epoch seconds divided by it), with
	 * how many of them read as errors (`LOG_ERROR_PATTERN`).
	 */
	static async volume(
		serviceId: string,
		since: Date,
		bucketSeconds: number,
	): Promise<{ bucket: number; errors: number; lines: number }[]> {
		const bucket = sql<number>`floor(extract(epoch from ${serviceLog.time}) / ${sql.raw(String(Math.trunc(bucketSeconds)))})`;
		const rows = await db
			.select({
				bucket,
				errors: sql<number>`count(*) filter (where ${serviceLog.line} ~* ${LOG_ERROR_PATTERN})`,
				lines: sql<number>`count(*)`,
			})
			.from(serviceLog)
			.where(
				and(eq(serviceLog.serviceId, serviceId), gte(serviceLog.time, since)),
			)
			.groupBy(bucket);
		return rows.map((row) => ({
			bucket: Number(row.bucket),
			errors: Number(row.errors ?? 0),
			lines: Number(row.lines ?? 0),
		}));
	}

	/** Which of `owner`'s instances (containers or swarm tasks) have stored lines, most recent first. */
	static async instances(owner: LogOwner): Promise<string[]> {
		const rows = await db
			.select({ instance: serviceLog.instance })
			.from(serviceLog)
			.where(ownerCondition(owner))
			.groupBy(serviceLog.instance)
			.orderBy(desc(sql`max(${serviceLog.time})`))
			.limit(50);
		return rows.map((row) => row.instance);
	}

	/** The oldest stored line's time for `owner`, null when nothing is stored. */
	static async oldest(owner: LogOwner): Promise<Date | null> {
		const [row] = await db
			.select({ time: sql<Date | null>`min(${serviceLog.time})` })
			.from(serviceLog)
			.where(ownerCondition(owner));
		return row?.time ? new Date(row.time) : null;
	}

	/** The names of Homerun's own containers that have stored lines, alphabetically. */
	static async systems(): Promise<string[]> {
		const rows = await db
			.selectDistinct({ system: serviceLog.system })
			.from(serviceLog)
			.where(isNotNull(serviceLog.system))
			.orderBy(serviceLog.system);
		return rows.flatMap((row) => (row.system ? [row.system] : []));
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
