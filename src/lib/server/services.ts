import { and, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type Service, service } from "$lib/server/db/schema";

/** Loads a service and confirms it belongs to `userId`, or returns null. Never trust a route param alone. */
export async function ownedService(
  serviceId: string,
  userId: string
): Promise<Service | null> {
  const [row] = await db
    .select()
    .from(service)
    .where(and(eq(service.id, serviceId), eq(service.userId, userId)))
    .limit(1);
  return row ?? null;
}
