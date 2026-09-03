import { eq } from "drizzle-orm";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import type { ContainerStatus } from "$lib/types";
import { AgentClientService } from "../agent-client.service.ts";
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
		/** Syncs one service's `currentStatus` with the live Docker state of its container (or swarm service). */
		async syncServiceStatus(
			serviceId: string,
			userId: string,
		): Promise<string> {
			const [row] = await db
				.select({
					containerId: service.containerId,
					remoteHostId: service.remoteHostId,
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

			const target = await RemoteHostDTO.resolveTarget(
				row.remoteHostId,
				userId,
			);
			const status =
				target.kind === "agent"
					? await AgentClientService.inspectStatus(
							target.connection,
							row.containerId,
						)
					: await this.inspectStatus(
							row.containerId,
							target.kind === "docker" ? target.connection : undefined,
						);
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
