import { z } from "zod";
import { query } from "$app/server";
import { ServiceDTO } from "$lib/dto/service-dto";
import { requireUser } from "$lib/server/remote-auth";
import { DockerService } from "$lib/services/docker.service";
import type { ContainerStatus } from "$lib/types";

export interface ServiceStatus {
	id: string;
	status: ContainerStatus;
}

export const syncServiceStatuses = query(
	z.array(z.string()),
	async (serviceIds): Promise<ServiceStatus[]> => {
		requireUser();
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
