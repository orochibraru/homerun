import { and, eq, inArray } from "drizzle-orm";
import { Logger } from "$lib/logger";
import { db } from "$lib/server/db/lib";
import {
  deployment,
  type Project,
  project,
  service,
} from "$lib/server/db/schema";
import { removeContainer } from "$lib/server/docker/service";

const logger = new Logger("Projects");

/** Loads a project and confirms it belongs to `userId`, or returns null. Never trust a route param alone. */
export async function ownedProject(
  projectId: string,
  userId: string
): Promise<Project | null> {
  const [row] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Deletes a project and everything in it — stops/removes every member
 * service's container, deletes their deployment history, deletes the
 * services, then the project itself. Same explicit-cleanup precedent as
 * account deletion (src/lib/server/auth.ts's beforeDelete hook): DB-level
 * cascade alone would leak running containers.
 */
export async function deleteProjectCascade(
  projectId: string,
  userId: string
): Promise<void> {
  const services = await db
    .select()
    .from(service)
    .where(and(eq(service.projectId, projectId), eq(service.userId, userId)));

  logger.info(
    `Cascading delete: project=${projectId} services=${services.length} user=${userId}`
  );

  await Promise.all(
    services
      .filter((svc) => svc.containerId)
      .map((svc) =>
        removeContainer(svc.containerId as string, { force: true }).catch(
          () => {
            // Already gone on the host — proceed with deleting the record.
          }
        )
      )
  );

  const serviceIds = services.map((svc) => svc.id);
  if (serviceIds.length > 0) {
    await db
      .delete(deployment)
      .where(inArray(deployment.serviceId, serviceIds));
  }
  await db.delete(service).where(eq(service.projectId, projectId));
  await db
    .delete(project)
    .where(and(eq(project.id, projectId), eq(project.userId, userId)));
  logger.info(`Project cascade delete complete: project=${projectId}`);
}
