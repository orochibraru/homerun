import { eq } from "drizzle-orm";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import type { ContainerStatus } from "$lib/types";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { RemoteHostConnection } from "./client.ts";

/** What this mixin needs from whatever's ahead of it in the merge chain (see docker.service.ts) : the container mixin's inspectStatus. */
interface RequiresContainerMixin {
	inspectStatus(
		containerId: string,
		remote?: RemoteHostConnection | null,
	): Promise<ContainerStatus>;
}

/**
 * Poll-on-page-load status reconciliation : syncs a service's
 * `currentStatus` column with the live Docker state of its container. No
 * background worker or Docker events subscriber for v1. Requires the
 * container mixin ahead of it in the merge chain : uses
 * `this.inspectStatus`.
 */
export function DockerReconcileMixin<
	TBase extends Constructor<BaseDockerService & RequiresContainerMixin>,
>(Base: TBase) {
	return class DockerReconcileService extends Base {
		/** Syncs one service's `currentStatus` with the live Docker state of its container. */
		async syncServiceStatus(
			serviceId: string,
			userId: string,
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
			const status = await this.inspectStatus(row.containerId, remote);
			await db
				.update(service)
				.set({ currentStatus: status })
				.where(eq(service.id, serviceId));

			return status;
		}

		/** Syncs every one of a user's services in parallel. Returns nothing : callers re-query the DB after. */
		async syncAllServiceStatuses(
			serviceIds: string[],
			userId: string,
		): Promise<void> {
			await Promise.all(
				serviceIds.map((id) => this.syncServiceStatus(id, userId)),
			);
		}
	};
}
