import { and, desc, eq, gte } from "drizzle-orm";

import { Logger } from "#lib/logger.js";
import { db } from "#lib/server/db/lib.js";
import { type ServiceEvent, serviceEvent } from "#lib/server/db/schema.js";
import { requestActor } from "#lib/server/request-actor.js";
import type { ServiceEventInput } from "#lib/service-events.js";

import { BaseDTO } from "./base-dto";

const logger = new Logger("ServiceEvents");

/** How many events a service's Activity card reads at most for one period. */
const LIST_LIMIT = 1000;

/** Wraps the `service_event` table: what was changed on a service, by whom and when, drawn as its Activity lanes. */
export class ServiceEventDTO extends BaseDTO<ServiceEvent> {
	/**
	 * Stores `events` for a service, attributed to the current request's user
	 * (none for a scheduler or other background work). Never throws: a
	 * failure to record is logged, so it can't undo the change it describes.
	 */
	static async record(
		serviceId: string,
		events: ServiceEventInput[],
	): Promise<void> {
		if (events.length === 0) {
			return;
		}
		const actor = requestActor();
		const createdAt = new Date();
		try {
			await db.insert(serviceEvent).values(
				events.map((event) => ({
					...event,
					actorId: actor?.id ?? null,
					actorName: actor?.name ?? null,
					createdAt,
					id: crypto.randomUUID(),
					serviceId,
				})),
			);
		} catch (error) {
			logger.warn(`Couldn't record activity for service=${serviceId}`, error);
		}
	}

	/** A service's events from `since` on (all of them when null), oldest first, the latest `limit` at most. */
	static async listForService(
		serviceId: string,
		since: Date | null,
		limit = LIST_LIMIT,
	): Promise<ServiceEventDTO[]> {
		const rows = await db
			.select()
			.from(serviceEvent)
			.where(
				since
					? and(
							eq(serviceEvent.serviceId, serviceId),
							gte(serviceEvent.createdAt, since),
						)
					: eq(serviceEvent.serviceId, serviceId),
			)
			.orderBy(desc(serviceEvent.createdAt))
			.limit(limit);
		return rows.reverse().map((row) => new ServiceEventDTO(row));
	}
}
