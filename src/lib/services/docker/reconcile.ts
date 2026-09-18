import { eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import type { ContainerStatus } from "$lib/types";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { RemoteHostConnection } from "./client.ts";

/** What this mixin needs from whatever's ahead of it in the merge chain (see docker.service.ts) : the container mixin's inspectStatus, the swarm mixin's inspectSwarmServiceStatus. */
interface RequiresContainerAndSwarmMixin {
	inspectStatus: (
		containerId: string,
		remote?: RemoteHostConnection | null,
	) => Promise<ContainerStatus>;
	inspectSwarmServiceStatus: (
		swarmServiceId: string,
	) => Promise<ContainerStatus>;
}

/**
 * Poll-on-page-load status reconciliation : syncs a service's
 * `currentStatus` column with the live Docker state of its container (or,
 * for a swarm-mode service, the aggregate state of its swarm service's
 * tasks). No background worker or Docker events subscriber for v1. Requires
 * the container and swarm mixins ahead of it in the merge chain.
 */
export function DockerReconcileMixin<
	TBase extends Constructor<BaseDockerService & RequiresContainerAndSwarmMixin>,
>(Base: TBase) {
	return class DockerReconcileService extends Base {
		/**
		 * Syncs one service's `currentStatus` with the live Docker state of its
		 * container (or swarm service). A container the user stopped counts as
		 * stopped whatever its exit code: `docker stop` SIGKILLs a process that
		 * outlives the stop timeout, and that 137 isn't a failure.
		 */
		async syncServiceStatus(serviceId: string): Promise<ContainerStatus> {
			const [row] = await db
				.select({
					containerId: service.containerId,
					desiredState: service.desiredState,
					swarmServiceId: service.swarmServiceId,
				})
				.from(service)
				.where(eq(service.id, serviceId))
				.limit(1);

			if (row?.swarmServiceId) {
				const status = await this.inspectSwarmServiceStatus(row.swarmServiceId);
				await db
					.update(service)
					.set({ currentStatus: status })
					.where(eq(service.id, serviceId));
				return status;
			}

			if (!row?.containerId) {
				return "pending";
			}

			const inspected = await this.inspectStatus(row.containerId);
			const status =
				inspected === "failed" && row.desiredState === "stopped"
					? "stopped"
					: inspected;
			await db
				.update(service)
				.set({ currentStatus: status })
				.where(eq(service.id, serviceId));

			return status;
		}

		/** Syncs every one of a user's services in parallel. Returns nothing : callers re-query the DB after. */
		async syncAllServiceStatuses(serviceIds: string[]): Promise<void> {
			await Promise.all(serviceIds.map((id) => this.syncServiceStatus(id)));
		}
	};
}
