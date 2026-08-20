import { count, desc, eq, inArray } from "drizzle-orm";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import { db } from "$lib/server/db/lib";
import type { User } from "$lib/server/db/schema";
import * as schema from "$lib/server/db/schema";
import { user as userTable } from "$lib/server/db/schema";
import { DockerService } from "./docker.service.ts";

const logger = new Logger("UserCleanup");

/** Read/cleanup operations for the `user` table and everything a user owns. */
class UserServiceClass {
	/**
	 * Stops/removes a user's actual Docker containers and networks and deletes
	 * their app-owned rows (deployments/services/projects/storage volumes)
	 *before* the user row itself goes away. Postgres enforces the schema's
	 * `onDelete: "cascade"`/`"set null"` FK constraints for real (unlike the
	 * previous SQLite setup, where `PRAGMA foreign_keys` was intentionally
	 * left off and cascade was decorative) : so this explicit cleanup is
	 * still required for anything with a real-world side effect a DB
	 * constraint can't touch (stopping/removing containers, Docker networks),
	 * but the row-level cascade is now a genuine DB-level safety net too, not
	 * just documentation.
	 *
	 * Shared by two callers that must both get this treatment:
	 * - auth.ts's `user.deleteUser.beforeDelete` hook (self-service account
	 *   deletion).
	 * - The Users page's admin "remove user" action. Real, tested-in-review
	 *   finding: better-auth's admin plugin `removeUser` endpoint calls
	 *   `internalAdapter.deleteUser()` directly, which does **not** run the
	 *   `deleteUser.beforeDelete` option : that option is only read by the
	 *   self-service delete-account endpoints (confirmed against
	 *   node_modules/better-auth/dist/api/routes/update-user.mjs : the only
	 *   place `beforeDelete`/`afterDelete` are referenced at all). Calling
	 *   `auth.api.removeUser` without first calling this method would leak
	 *   the removed user's running containers.
	 */
	async cleanupUserResources(userId: string): Promise<void> {
		const services = await db
			.select()
			.from(schema.service)
			.where(eq(schema.service.userId, userId));

		logger.info(
			`Cleaning up user resources: user=${userId} services=${services.length}`,
		);

		await Promise.all(
			services
				.filter((svc) => svc.containerId)
				.map(async (svc) => {
					try {
						const remote = await RemoteHostDTO.connectionFor(svc, userId);
						await DockerService.removeContainer(
							svc.containerId as string,
							{ force: true },
							remote,
						);
					} catch {
						// Already gone on the host : fine, keep cleaning up.
					}
				}),
		);

		await db
			.delete(schema.deployment)
			.where(eq(schema.deployment.userId, userId));
		await db.delete(schema.service).where(eq(schema.service.userId, userId));

		// Same explicit-cleanup precedent as services above : FK cascade alone
		// would leave the project's Docker network dangling.
		const projects = await db
			.select()
			.from(schema.project)
			.where(eq(schema.project.userId, userId));
		await Promise.all(
			projects.map((proj) =>
				DockerService.removeProjectNetwork(proj.id).catch(() => {
					// Already gone : fine, keep cleaning up.
				}),
			),
		);
		await db.delete(schema.project).where(eq(schema.project.userId, userId));

		// Row-only : no host-side resource (unlike services/projects, nothing was
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
					volumes.map((v) => v.id),
				),
			);
		}
		await db
			.delete(schema.storageVolume)
			.where(eq(schema.storageVolume.userId, userId));

		logger.info(`User resource cleanup complete: user=${userId}`);
	}

	/**
	 * Small read helpers for the `user` table, used by the admin Users page.
	 * Raw queries rather than a DTO : there's no DTO for better-auth-owned
	 * tables, same precedent hooks.server.ts and auth.ts already use.
	 */
	async listUsers(): Promise<User[]> {
		return await db.select().from(userTable).orderBy(desc(userTable.createdAt));
	}

	async countAdmins(): Promise<number> {
		const [row] = await db
			.select({ total: count() })
			.from(userTable)
			.where(eq(userTable.role, "admin"));
		return row?.total ?? 0;
	}
}

export const UserService = new UserServiceClass();
