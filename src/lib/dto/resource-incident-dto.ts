import {
	and,
	count,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";

import type {
	IncidentSample,
	ResourceIncidentState,
} from "#lib/resource-incidents.js";
import { RESOURCE_KINDS } from "#lib/resource-thresholds.js";
import { db } from "#lib/server/db/lib.js";
import {
	type ResourceIncident,
	resourceIncident,
} from "#lib/server/db/schema.js";
import {
	escapeLike,
	type ListQuery,
	narrowFilter,
	type PagedResult,
} from "#lib/server/list-query.js";

import { BaseDTO } from "./base-dto";

/** The `host` filter's value for this server, as opposed to a remote host's id. */
export const LOCAL_HOST_FILTER = "local";

/** Which host's incidents a query reads: this server's when null. */
function onHost(remoteHostId: string | null): SQL {
	return remoteHostId === null
		? isNull(resourceIncident.remoteHostId)
		: eq(resourceIncident.remoteHostId, remoteHostId);
}

/**
 * Wraps `resource_incident`: one row per time a resource on this server or
 * on a remote host stayed past its soft or hard limit, from when it opened
 * to when it recovered, with its peak, how many alerts it sent, the biggest
 * users at its last alert and the host's readings every minute it lasted.
 * Kept so a restart neither alerts again for an incident already open nor
 * loses its recovery, and listed under Monitoring → Incidents.
 */
export class ResourceIncidentDTO extends BaseDTO<ResourceIncident> {
	/** The incidents still open on one host (this server when null), as the tracker holds them. */
	static async listOpen(
		remoteHostId: string | null,
	): Promise<ResourceIncidentState[]> {
		const rows = await db
			.select()
			.from(resourceIncident)
			.where(and(isNull(resourceIncident.resolvedAt), onHost(remoteHostId)));
		return rows.map((row) => ({
			causes: row.causes,
			id: row.id,
			kind: row.kind,
			lastNotifiedAt: row.lastNotifiedAt.getTime(),
			level: row.level,
			peak: row.peakPercent,
			startedAt: row.startedAt.getTime(),
		}));
	}

	/** One incident by id; null when missing. */
	static async get(id: string): Promise<ResourceIncidentDTO | null> {
		const [row] = await db
			.select()
			.from(resourceIncident)
			.where(eq(resourceIncident.id, id))
			.limit(1);
		return row ? new ResourceIncidentDTO(row) : null;
	}

	/**
	 * One page of incidents, newest first, searched by what their causes
	 * name, and narrowed by the `host` (`local` or
	 * a remote host's id), `status` (`open`, `resolved`), `resource` and
	 * `level` filters.
	 */
	static async listPaged(
		query: ListQuery,
	): Promise<PagedResult<ResourceIncidentDTO>> {
		const conditions: SQL[] = [];
		if (query.q) {
			conditions.push(
				sql`${resourceIncident.causes}::text ilike ${`%${escapeLike(query.q)}%`}`,
			);
		}
		const hosts = query.filters.host ?? [];
		if (hosts.length > 0) {
			const remoteIds = hosts.filter((host) => host !== LOCAL_HOST_FILTER);
			const matches: SQL[] = [];
			if (hosts.includes(LOCAL_HOST_FILTER)) {
				matches.push(isNull(resourceIncident.remoteHostId));
			}
			if (remoteIds.length > 0) {
				matches.push(inArray(resourceIncident.remoteHostId, remoteIds));
			}
			const host = or(...matches);
			if (host) {
				conditions.push(host);
			}
		}
		const statuses = narrowFilter(query.filters.status, [
			"open",
			"resolved",
		] as const);
		if (statuses.length === 1) {
			conditions.push(
				statuses[0] === "open"
					? isNull(resourceIncident.resolvedAt)
					: isNotNull(resourceIncident.resolvedAt),
			);
		}
		const kinds = narrowFilter(query.filters.resource, RESOURCE_KINDS);
		if (kinds.length > 0) {
			conditions.push(inArray(resourceIncident.kind, kinds));
		}
		const levels = narrowFilter(query.filters.level, ["hard", "soft"] as const);
		if (levels.length > 0) {
			conditions.push(inArray(resourceIncident.level, levels));
		}
		const where = and(...conditions);
		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(resourceIncident)
				.where(where)
				.orderBy(desc(resourceIncident.startedAt))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(resourceIncident).where(where),
		]);
		return {
			items: rows.map((row) => new ResourceIncidentDTO(row)),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/**
	 * Records an incident that just opened on a host (this server when
	 * `remoteHostId` is null), with the readings taken since its breach began.
	 *
	 * @returns Its id.
	 */
	static async open(
		incident: ResourceIncidentState,
		remoteHostId: string | null,
		samples: IncidentSample[],
	): Promise<string> {
		const id = crypto.randomUUID();
		await db.insert(resourceIncident).values({
			causes: incident.causes,
			id,
			kind: incident.kind,
			lastNotifiedAt: new Date(incident.lastNotifiedAt),
			level: incident.level,
			notifications: 1,
			peakPercent: incident.peak,
			remoteHostId,
			samples,
			startedAt: new Date(incident.startedAt),
		});
		return id;
	}

	/** Records an alert an open incident sent (an escalation or a reminder) with the causes it named, or its recovery when `resolvedAt` is given. */
	static async notified(
		incident: ResourceIncidentState,
		notifications: number,
		resolvedAt: Date | null = null,
	): Promise<void> {
		if (!incident.id) {
			return;
		}
		await db
			.update(resourceIncident)
			.set({
				causes: incident.causes,
				lastNotifiedAt: new Date(incident.lastNotifiedAt),
				level: incident.level,
				notifications,
				peakPercent: incident.peak,
				resolvedAt,
			})
			.where(eq(resourceIncident.id, incident.id));
	}

	/**
	 * Appends one reading of the host, and each incident's peak so far, to the
	 * incidents still open on it. The array is rebuilt here rather than with
	 * SQL `||`: the Bun SQL driver stores jsonb as a JSON string, so an append
	 * in SQL adds strings instead of readings.
	 */
	static async addSample(
		incidents: ResourceIncidentState[],
		sample: IncidentSample,
	): Promise<void> {
		await Promise.all(
			incidents.map(async ({ id, peak }) => {
				if (!id) {
					return;
				}
				const [row] = await db
					.select({ samples: resourceIncident.samples })
					.from(resourceIncident)
					.where(eq(resourceIncident.id, id))
					.limit(1);
				if (!row) {
					return;
				}
				await db
					.update(resourceIncident)
					.set({ peakPercent: peak, samples: [...row.samples, sample] })
					.where(eq(resourceIncident.id, id));
			}),
		);
	}

	/** The incident without its readings, for a list. */
	summary(): Omit<ResourceIncident, "samples"> {
		const { samples: _samples, ...rest } = this.row;
		return rest;
	}

	/** How many alerts the incident has sent so far. */
	static async notificationCount(id: string): Promise<number> {
		const [row] = await db
			.select({ notifications: resourceIncident.notifications })
			.from(resourceIncident)
			.where(eq(resourceIncident.id, id))
			.limit(1);
		return row?.notifications ?? 0;
	}
}
