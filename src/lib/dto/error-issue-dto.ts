import {
	and,
	count,
	countDistinct,
	desc,
	eq,
	getTableColumns,
	inArray,
	lt,
	type SQL,
	sql,
} from "drizzle-orm";
import type { IssueStatus, StoredErrorEvent } from "$lib/error-tracking/event";
import { db } from "$lib/server/db/lib";
import { type ErrorIssue, errorEvent, errorIssue } from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
	sortOrder,
} from "$lib/server/list-query";
import { BaseDTO } from "./base-dto";

export type ErrorIssueRow = ErrorIssue & { usersAffected: number };

export interface RecordedIssue {
	created: boolean;
	issue: ErrorIssue;
	regressed: boolean;
}

const STATUSES = new Set<string>(["unresolved", "resolved", "ignored"]);

function usersAffectedOf(issueId: SQL | typeof errorIssue.id) {
	return sql<number>`(select count(distinct ${errorEvent.userKey})::int from ${errorEvent} where ${errorEvent.issueId} = ${issueId})`;
}

/** Wraps `error_issue`: one group of events that share a grouping hash within a service. */
export class ErrorIssueDTO extends BaseDTO<ErrorIssue> {
	get id(): string {
		return this.row.id;
	}

	/** One issue of a service, or null when it isn't that service's. */
	static async getForService(
		serviceId: string,
		issueId: string,
	): Promise<ErrorIssueDTO | null> {
		const [row] = await db
			.select()
			.from(errorIssue)
			.where(
				and(eq(errorIssue.id, issueId), eq(errorIssue.serviceId, serviceId)),
			)
			.limit(1);
		return row ? new ErrorIssueDTO(row) : null;
	}

	/**
	 * A page of a service's issues, most recently seen first, filtered by the
	 * `status` filter (unresolved when none is given, `all` for every status)
	 * and searched over title and culprit. Each row carries the distinct users
	 * its retained events name.
	 */
	static async listPaged(
		serviceId: string,
		query: ListQuery,
	): Promise<PagedResult<ErrorIssueRow>> {
		const requested = query.filters.status ?? ["unresolved"];
		const statuses = requested.includes("all")
			? []
			: requested.filter((status): status is IssueStatus =>
					STATUSES.has(status),
				);
		const conditions: SQL[] = [eq(errorIssue.serviceId, serviceId)];
		if (statuses.length > 0) {
			conditions.push(inArray(errorIssue.status, statuses));
		}
		const search = searchCondition(query.q, [
			errorIssue.title,
			errorIssue.culprit,
		]);
		if (search) {
			conditions.push(search);
		}
		const where = and(...conditions);
		const [rows, totals] = await Promise.all([
			db
				.select({
					issue: errorIssue,
					usersAffected: usersAffectedOf(errorIssue.id),
				})
				.from(errorIssue)
				.where(where)
				.orderBy(
					...sortOrder(
						query.sort,
						{
							count: errorIssue.count,
							firstSeen: errorIssue.firstSeen,
							lastSeen: errorIssue.lastSeen,
						},
						desc(errorIssue.lastSeen),
					),
				)
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(errorIssue).where(where),
		]);
		return {
			items: rows.map((row) => ({
				...row.issue,
				usersAffected: row.usersAffected,
			})),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/** How many unresolved issues each of the given services has, keyed by service id; every service when none are given. */
	static async countOpenByService(
		serviceIds?: string[],
	): Promise<Map<string, number>> {
		const conditions: SQL[] = [eq(errorIssue.status, "unresolved")];
		if (serviceIds) {
			if (serviceIds.length === 0) {
				return new Map();
			}
			conditions.push(inArray(errorIssue.serviceId, serviceIds));
		}
		const rows = await db
			.select({ open: count(), serviceId: errorIssue.serviceId })
			.from(errorIssue)
			.where(and(...conditions))
			.groupBy(errorIssue.serviceId);
		return new Map(rows.map((row) => [row.serviceId, row.open]));
	}

	/**
	 * Counts one event into the issue with its grouping hash, creating the
	 * issue on first sight. A resolved issue seen again goes back to
	 * unresolved and is stamped regressed; an ignored one stays ignored. The
	 * reopen is a conditional update and the count an upsert, so concurrent
	 * events can neither create an issue twice nor both report its regression.
	 */
	static async record(
		serviceId: string,
		fingerprint: string,
		event: StoredErrorEvent,
		receivedAt: Date,
	): Promise<RecordedIssue> {
		const exception = event.exceptions.at(-1) ?? null;
		const seenAt = new Date(event.timestamp);
		const reopened = await db
			.update(errorIssue)
			.set({ regressedAt: receivedAt, resolvedAt: null, status: "unresolved" })
			.where(
				and(
					eq(errorIssue.serviceId, serviceId),
					eq(errorIssue.fingerprint, fingerprint),
					eq(errorIssue.status, "resolved"),
				),
			)
			.returning({ id: errorIssue.id });
		const [row] = await db
			.insert(errorIssue)
			.values({
				count: 1,
				culprit: event.culprit,
				fingerprint,
				firstRelease: event.release,
				firstSeen: seenAt,
				id: crypto.randomUUID(),
				lastEnvironment: event.environment,
				lastRelease: event.release,
				lastSeen: seenAt,
				level: event.level,
				platform: event.platform,
				serviceId,
				title: event.title,
				type: exception?.type ?? null,
				value: exception?.value ?? event.message,
			})
			.onConflictDoUpdate({
				set: {
					count: sql`${errorIssue.count} + 1`,
					culprit: sql`coalesce(excluded.culprit, ${errorIssue.culprit})`,
					lastEnvironment: sql`coalesce(excluded.last_environment, ${errorIssue.lastEnvironment})`,
					lastRelease: sql`coalesce(excluded.last_release, ${errorIssue.lastRelease})`,
					lastSeen: sql`greatest(${errorIssue.lastSeen}, excluded.last_seen)`,
					level: sql`excluded.level`,
				},
				target: [errorIssue.serviceId, errorIssue.fingerprint],
			})
			.returning({
				...getTableColumns(errorIssue),
				inserted: sql<boolean>`(xmax = 0)`,
			});
		const { inserted, ...issue } = row;
		return {
			created: inserted,
			issue,
			regressed: reopened.length > 0,
		};
	}

	/**
	 * Sets the status of some of a service's issues, stamping `resolvedAt` on
	 * resolve and clearing it otherwise. Ids of other services are ignored.
	 *
	 * @returns How many issues changed.
	 */
	static async setStatus(
		serviceId: string,
		issueIds: string[],
		status: IssueStatus,
	): Promise<number> {
		if (issueIds.length === 0) {
			return 0;
		}
		const rows = await db
			.update(errorIssue)
			.set({
				resolvedAt: status === "resolved" ? new Date() : null,
				status,
			})
			.where(
				and(
					eq(errorIssue.serviceId, serviceId),
					inArray(errorIssue.id, issueIds),
				),
			)
			.returning({ id: errorIssue.id });
		return rows.length;
	}

	/** Deletes resolved and ignored issues not seen since `before`, their events with them. */
	static async pruneClosed(before: Date): Promise<void> {
		await db
			.delete(errorIssue)
			.where(
				and(
					inArray(errorIssue.status, ["resolved", "ignored"]),
					lt(errorIssue.lastSeen, before),
				),
			);
	}

	/** The distinct users this issue's retained events name. */
	async usersAffected(): Promise<number> {
		const [row] = await db
			.select({ users: countDistinct(errorEvent.userKey) })
			.from(errorEvent)
			.where(eq(errorEvent.issueId, this.row.id));
		return row?.users ?? 0;
	}
}
