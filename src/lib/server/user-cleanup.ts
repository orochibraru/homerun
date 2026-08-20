import { eq, inArray } from "drizzle-orm";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import { db } from "$lib/server/db/lib";
// biome-ignore lint/performance/noNamespaceImport: mirrors auth.ts's own import of the whole schema module.
import * as schema from "$lib/server/db/schema";
import { removeProjectNetwork } from "$lib/server/docker/networks";
import { removeContainer } from "$lib/server/docker/service";

const logger = new Logger("UserCleanup");

/**
 * Stops/removes a user's actual Docker containers and networks and deletes
 * their app-owned rows (deployments/services/projects/storage volumes)
 *before* the user row itself goes away — PRAGMA foreign_keys is never
 * enabled on the sqlite connection, so onDelete:cascade in the schema is
 * decorative for anything with a real-world side effect.
 *
 * Shared by two callers that must both get this treatment:
 * - auth.ts's `user.deleteUser.beforeDelete` hook (self-service account
 *   deletion).
 * - The Users page's admin "remove user" action. Real, tested-in-review
 *   finding: better-auth's admin plugin `removeUser` endpoint calls
 *   `internalAdapter.deleteUser()` directly, which does **not** run the
 *   `deleteUser.beforeDelete` option — that option is only read by the
 *   self-service delete-account endpoints (confirmed against
 *   node_modules/better-auth/dist/api/routes/update-user.mjs — the only
 *   place `beforeDelete`/`afterDelete` are referenced at all). Calling
 *   `auth.api.removeUser` without first calling this function would leak
 *   the removed user's running containers.
 */
export async function cleanupUserResources(userId: string): Promise<void> {
  const services = await db
    .select()
    .from(schema.service)
    .where(eq(schema.service.userId, userId));

  logger.info(
    `Cleaning up user resources: user=${userId} services=${services.length}`
  );

  await Promise.all(
    services
      .filter((svc) => svc.containerId)
      .map(async (svc) => {
        try {
          const remote = await RemoteHostDTO.connectionFor(svc, userId);
          await removeContainer(
            svc.containerId as string,
            { force: true },
            remote
          );
        } catch {
          // Already gone on the host — fine, keep cleaning up.
        }
      })
  );

  await db
    .delete(schema.deployment)
    .where(eq(schema.deployment.userId, userId));
  await db.delete(schema.service).where(eq(schema.service.userId, userId));

  // Same explicit-cleanup precedent as services above — FK cascade alone
  // would leave the project's Docker network dangling.
  const projects = await db
    .select()
    .from(schema.project)
    .where(eq(schema.project.userId, userId));
  await Promise.all(
    projects.map((proj) =>
      removeProjectNetwork(proj.id).catch(() => {
        // Already gone — fine, keep cleaning up.
      })
    )
  );
  await db.delete(schema.project).where(eq(schema.project.userId, userId));

  // Row-only — no host-side resource (unlike services/projects, nothing was
  // ever created on the user's behalf just by defining a storage volume
  // source). Delete the join rows first (no userId column of its own to
  // filter by directly).
  const volumes = await db
    .select({ id: schema.storageVolume.id })
    .from(schema.storageVolume)
    .where(eq(schema.storageVolume.userId, userId));
  if (volumes.length > 0) {
    await db.delete(schema.serviceVolume).where(
      inArray(
        schema.serviceVolume.volumeId,
        volumes.map((v) => v.id)
      )
    );
  }
  await db
    .delete(schema.storageVolume)
    .where(eq(schema.storageVolume.userId, userId));

  logger.info(`User resource cleanup complete: user=${userId}`);
}
