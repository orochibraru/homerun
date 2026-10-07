import { z } from "zod";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { requirePermission } from "#lib/server/remote-auth.js";
import { DockerService } from "#lib/services/docker.service.js";
import type { ContainerStatus } from "#lib/types.js";
import { query } from "$app/server";

export interface ServiceStatus {
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
		return await Promise.all(
			requested.map(async (svc) => ({
				id: svc.id,
				status: await DockerService.syncServiceStatus(svc.id),
			})),
		);
	},
);
