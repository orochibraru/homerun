import { query } from "$app/server";
import { z } from "zod";

import { DeploymentDTO } from "#lib/dto/deployment-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { requirePermission } from "#lib/server/remote-auth.js";
import { DockerService } from "#lib/services/docker.service.js";
import type { ContainerStatus, RevisionHealth } from "#lib/types.js";

export interface ServiceStatus {
	/** The current revision's health, null when its health check is off or it has none yet. */
	health: RevisionHealth | null;
	/** Why the current revision was judged unhealthy, when it was. */
	healthReason: string | null;
	id: string;
	status: ContainerStatus;
}

export const syncServiceStatuses = query(
	z.array(z.string()),
	async (serviceIds): Promise<ServiceStatus[]> => {
		requirePermission("services", "read");
		if (serviceIds.length === 0) {
			return [];
		}
		const services = await ServiceDTO.list();
		const requested = services.filter((svc) => serviceIds.includes(svc.id));
		const health = await DeploymentDTO.currentHealth(
			requested.map((svc) => svc.id),
		);
		return await Promise.all(
			requested.map(async (svc) => {
				const current = svc.healthcheckDisabled ? null : health.get(svc.id);
				return {
					health: current?.health ?? null,
					healthReason: current?.reason ?? null,
					id: svc.id,
					status: await DockerService.syncServiceStatus(svc.id),
				};
			}),
		);
	},
);
