import { eq } from "drizzle-orm";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import { inspectStatus } from "./service.ts";

/**
 * Syncs one service's `currentStatus` with the live Docker state of its
 * container. Called from page loads (poll-on-visit) — no background
 * worker or Docker events subscriber for v1.
 */
export async function syncServiceStatus(
  serviceId: string,
  userId: string
): Promise<string> {
  const [row] = await db
    .select({
      containerId: service.containerId,
      remoteHostId: service.remoteHostId,
    })
    .from(service)
    .where(eq(service.id, serviceId))
    .limit(1);

  if (!row?.containerId) {
    return "pending";
  }

  const remote = row.remoteHostId
    ? await RemoteHostDTO.connectionFor(row, userId)
    : undefined;
  const status = await inspectStatus(row.containerId, remote);
  await db
    .update(service)
    .set({ currentStatus: status })
    .where(eq(service.id, serviceId));

  return status;
}

/** Syncs every one of a user's services in parallel. Returns nothing — callers re-query the DB after. */
export async function syncAllServiceStatuses(
  serviceIds: string[],
  userId: string
): Promise<void> {
  await Promise.all(serviceIds.map((id) => syncServiceStatus(id, userId)));
}
