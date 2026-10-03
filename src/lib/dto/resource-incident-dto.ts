import { desc, eq, isNull } from "drizzle-orm";
import type { ResourceIncidentState } from "#lib/resource-incidents.js";
import { db } from "#lib/server/db/lib.js";
import {
	type ResourceIncident,
	resourceIncident,
} from "#lib/server/db/schema.js";
import { BaseDTO } from "./base-dto";

/**
 * Wraps `resource_incident`: one row per time a server resource stayed past
 * its soft or hard limit, from when it opened to when it recovered, with its
 * peak and how many alerts it sent. Kept so a restart neither alerts again
 * for an incident already open nor loses its recovery, and listed under
 * Settings.
 */
export class ResourceIncidentDTO extends BaseDTO<ResourceIncident> {
	/** The incidents still open, as the tracker holds them. */
	static async listOpen(): Promise<ResourceIncidentState[]> {
		const rows = await db
			.select()
			.from(resourceIncident)
			.where(isNull(resourceIncident.resolvedAt));
		return rows.map((row) => ({
			id: row.id,
			kind: row.kind,
			lastNotifiedAt: row.lastNotifiedAt.getTime(),
			level: row.level,
			peak: row.peakPercent,
			startedAt: row.startedAt.getTime(),
		}));
	}

	/** The most recent incidents, newest first. */
	static async recent(limit = 10): Promise<ResourceIncidentDTO[]> {
		const rows = await db
			.select()
			.from(resourceIncident)
			.orderBy(desc(resourceIncident.startedAt))
			.limit(limit);
		return rows.map((row) => new ResourceIncidentDTO(row));
	}

	/**
	 * Records an incident that just opened.
	 *
	 * @returns Its id.
	 */
	static async open(incident: ResourceIncidentState): Promise<string> {
		const id = crypto.randomUUID();
		await db.insert(resourceIncident).values({
			id,
			kind: incident.kind,
			lastNotifiedAt: new Date(incident.lastNotifiedAt),
			level: incident.level,
			notifications: 1,
			peakPercent: incident.peak,
			startedAt: new Date(incident.startedAt),
		});
		return id;
	}

	/** Records an alert an open incident sent (an escalation or a reminder), or its recovery when `resolvedAt` is given. */
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
				lastNotifiedAt: new Date(incident.lastNotifiedAt),
				level: incident.level,
				notifications,
				peakPercent: incident.peak,
				resolvedAt,
			})
			.where(eq(resourceIncident.id, incident.id));
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
