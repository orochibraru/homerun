import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	ne,
	type SQL,
	sql,
} from "drizzle-orm";
import { Logger } from "$lib/logger";
import { db } from "$lib/server/db/lib";
import type { User } from "$lib/server/db/schema";
import * as schema from "$lib/server/db/schema";
import { user as userTable } from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
} from "$lib/server/list-query";
import { DockerService } from "./docker.service.ts";

const logger = new Logger("UserCleanup");

/** Read/cleanup operations for the `user` table and everything a user created. */
class UserServiceClass {
	/**
	 * Hands every shared resource a user created (services, stacks, deployments,
	 * jobs, volumes, S3 destinations, build cache registries, remote hosts, cron
	 * jobs, status pages, custom templates, pending invites and registered OIDC
	 * apps) over to another account *before* the user row goes away, since
	 * every one of those foreign keys is `onDelete: cascade` and would
	 * otherwise delete the rows and orphan their running containers. Personal
	 * rows (sessions, API keys, preferences, git connections, the bell feed,
	 * notification channels) still cascade away with the user. A transferred
	 * git service builds with its new owner's git connection from then on.
	 *
	 * The successor is `actingUserId` when given (the admin removing someone),
	 * otherwise the oldest other admin, otherwise the oldest other account.
	 * When the user is the last account there's nobody to hand over to, so
	 * their containers and stack networks are removed and the rows cascade.
	 *
	 * Shared by two callers that must both get this treatment:
	 * - auth.ts's `user.deleteUser.beforeDelete` hook (self-service account
	 *   deletion).
	 * - The Users page's admin "remove user" action. better-auth's admin
	 *   plugin `removeUser` endpoint calls `internalAdapter.deleteUser()`
	 *   directly, which does **not** run the `deleteUser.beforeDelete`
	 *   option, so that action has to call this itself first.
	 */
	async cleanupUserResources(
		userId: string,
		actingUserId?: string,
	): Promise<void> {
		const successorId =
			actingUserId && actingUserId !== userId
				? actingUserId
				: await this.#successorFor(userId);
		if (!successorId) {
			await this.#removeHostResources(userId);
			return;
		}

		logger.info(
			`Handing over user resources: user=${userId} successor=${successorId}`,
		);
		const reassign = { userId: successorId };
		await Promise.all([
			db
				.update(schema.service)
				.set(reassign)
				.where(eq(schema.service.userId, userId)),
			db
				.update(schema.stack)
				.set(reassign)
				.where(eq(schema.stack.userId, userId)),
			db
				.update(schema.deployment)
				.set(reassign)
				.where(eq(schema.deployment.userId, userId)),
			db.update(schema.job).set(reassign).where(eq(schema.job.userId, userId)),
			db
				.update(schema.storageVolume)
				.set(reassign)
				.where(eq(schema.storageVolume.userId, userId)),
			db
				.update(schema.s3Destination)
				.set(reassign)
				.where(eq(schema.s3Destination.userId, userId)),
			db
				.update(schema.buildCacheRegistry)
				.set(reassign)
				.where(eq(schema.buildCacheRegistry.userId, userId)),
			db
				.update(schema.remoteHost)
				.set(reassign)
				.where(eq(schema.remoteHost.userId, userId)),
			db
				.update(schema.cronJob)
				.set(reassign)
				.where(eq(schema.cronJob.userId, userId)),
			db
				.update(schema.statusPage)
				.set(reassign)
				.where(eq(schema.statusPage.userId, userId)),
			db
				.update(schema.oauthClient)
				.set(reassign)
				.where(eq(schema.oauthClient.userId, userId)),
			db
				.update(schema.template)
				.set({ ownerId: successorId })
				.where(eq(schema.template.ownerId, userId)),
			db
				.update(schema.invitation)
				.set({ invitedByUserId: successorId })
				.where(eq(schema.invitation.invitedByUserId, userId)),
		]);
		logger.info(`User resource hand-over complete: user=${userId}`);
	}

	/**
	 * The account that inherits a deleted user's resources: the oldest other
	 * admin, else the oldest other account, else null.
	 */
	async #successorFor(userId: string): Promise<string | null> {
		const [row] = await db
			.select({ id: userTable.id })
			.from(userTable)
			.where(ne(userTable.id, userId))
			.orderBy(
				sql`case when ${userTable.role} = 'admin' then 0 else 1 end`,
				asc(userTable.createdAt),
			)
			.limit(1);
		return row ? row.id : null;
	}

	/**
	 * Removes the last account's containers and stack networks, which a
	 * database cascade can't reach; the rows themselves cascade with the user.
	 */
	async #removeHostResources(userId: string): Promise<void> {
		const [services, stacks] = await Promise.all([
			db.select().from(schema.service).where(eq(schema.service.userId, userId)),
			db
				.select({ id: schema.stack.id })
				.from(schema.stack)
				.where(eq(schema.stack.userId, userId)),
		]);
		logger.info(
			`Removing the last account's resources: user=${userId} services=${services.length}`,
		);
		await Promise.all(
			services.map((svc) => {
				if (svc.swarmServiceId) {
					return DockerService.removeSwarmService(svc.swarmServiceId).catch(
						() => undefined,
					);
				}
				if (svc.containerId) {
					return DockerService.removeContainer(svc.containerId, {
						force: true,
					}).catch(() => undefined);
				}
				return Promise.resolve();
			}),
		);
		await Promise.all(
			stacks.map((stack) =>
				DockerService.removeStackNetwork(stack.id).catch(() => undefined),
			),
		);
	}

	/**
	 * Small read helpers for the `user` table, used by the admin Users page.
	 * Raw queries rather than a DTO : there's no DTO for better-auth-owned
	 * tables, same precedent hooks.server.ts and auth.ts already use.
	 */
	async listUsers(): Promise<User[]> {
		return await db.select().from(userTable).orderBy(desc(userTable.createdAt));
	}

	/** One page of `listUsers`, searched/filtered server-side, plus the unpaged total. */
	async listUsersPaged(query: ListQuery): Promise<PagedResult<User>> {
		const conditions: SQL[] = [];
		const search = searchCondition(query.q, [userTable.name, userTable.email]);
		if (search) {
			conditions.push(search);
		}
		const roles = query.filters.role;
		if (roles && roles.length > 0) {
			conditions.push(inArray(userTable.role, roles));
		}
		const where = conditions.length > 0 ? and(...conditions) : undefined;

		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(userTable)
				.where(where)
				.orderBy(desc(userTable.createdAt))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(userTable).where(where),
		]);

		return {
			items: rows,
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/** Users matching `q` against name/email, newest first, capped at `limit`. Used by lookups that need a short candidate list rather than a full paged listing (e.g. an owner picker). */
	async searchUsers(q: string, limit: number): Promise<User[]> {
		return await db
			.select()
			.from(userTable)
			.where(searchCondition(q, [userTable.name, userTable.email]))
			.orderBy(desc(userTable.createdAt))
			.limit(limit);
	}

	/** Stamps `userId`'s last sign-in time, called from better-auth's session-create hook. */
	async recordSignIn(userId: string, at: Date): Promise<void> {
		await db
			.update(userTable)
			.set({ lastSignInAt: at })
			.where(eq(userTable.id, userId));
	}

	/** The oldest admin user's id, or null if there is none. Used to attribute system-initiated actions (e.g. the scheduled mirror cleanup) to a real user. */
	async firstAdminId(): Promise<string | null> {
		const [row] = await db
			.select({ id: userTable.id })
			.from(userTable)
			.where(eq(userTable.role, "admin"))
			.orderBy(asc(userTable.createdAt))
			.limit(1);
		return row ? row.id : null;
	}

	/** How many users currently hold the `admin` role. */
	async countAdmins(): Promise<number> {
		const [row] = await db
			.select({ total: count() })
			.from(userTable)
			.where(eq(userTable.role, "admin"));
		return row?.total ?? 0;
	}
}

export const UserService = new UserServiceClass();
