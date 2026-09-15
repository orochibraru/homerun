import { desc, eq, inArray } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { service, type UptimeCheck, uptimeCheck } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export type ProbeKind = "internal" | "external";

export interface ProbeResult {
	detail?: string | null;
	kind: ProbeKind;
	latencyMs?: number | null;
	ok: boolean;
	serviceId: string;
	target?: string | null;
}

/** Wraps `uptime_check` : the latest result of each liveness probe, see schema.ts. */
export class UptimeCheckDTO extends BaseDTO<UptimeCheck> {
	/** Upserts one probe result, keyed on (service, kind). */
	static async record(result: ProbeResult): Promise<void> {
		const row = {
			checkedAt: new Date(),
			detail: result.detail ?? null,
			kind: result.kind,
			latencyMs: result.latencyMs ?? null,
			ok: result.ok,
			serviceId: result.serviceId,
			target: result.target ?? null,
		};
		await db
			.insert(uptimeCheck)
			.values(row)
			.onConflictDoUpdate({
				set: row,
				target: [uptimeCheck.serviceId, uptimeCheck.kind],
			});
	}

	static async listForService(serviceId: string): Promise<UptimeCheck[]> {
		return await db
			.select()
			.from(uptimeCheck)
			.where(eq(uptimeCheck.serviceId, serviceId))
			.orderBy(desc(uptimeCheck.kind));
	}

	/** Every probe for the services a user owns, for the dashboard's summary. */
	static async listForUser(userId: string): Promise<UptimeCheck[]> {
		const owned = await db
			.select({ id: service.id })
			.from(service)
			.where(eq(service.userId, userId));
		if (owned.length === 0) {
			return [];
		}
		return await db
			.select()
			.from(uptimeCheck)
			.where(
				inArray(
					uptimeCheck.serviceId,
					owned.map((row) => row.id),
				),
			);
	}
}
