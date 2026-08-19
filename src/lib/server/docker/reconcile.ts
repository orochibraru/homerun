import { eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import { inspectStatus } from "./service.ts";

/**
 * Syncs one service's `currentStatus` with the live Docker state of its
 * container. Called from page loads (poll-on-visit) — no background
 * worker or Docker events subscriber for v1.
 */
export async function syncServiceStatus(serviceId: string): Promise<string> {
  const [row] = await db
    .select({ containerId: service.containerId })
    .from(service)
    .where(eq(service.id, serviceId))
    .limit(1);

  if (!row?.containerId) {
    return "pending";
  }

  const status = await inspectStatus(row.containerId);
  await db
    .update(service)
    .set({ currentStatus: status })
    .where(eq(service.id, serviceId));

  return status;
}

/** Syncs every one of a user's services in parallel. Returns nothing — callers re-query the DB after. */
export async function syncAllServiceStatuses(
  serviceIds: string[]
): Promise<void> {
  await Promise.all(serviceIds.map((id) => syncServiceStatus(id)));
}
