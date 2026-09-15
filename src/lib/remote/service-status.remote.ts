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
		const user = requireUser();
		if (serviceIds.length === 0) {
			return [];
		}
		const owned = await ServiceDTO.list(user.id);
		const mine = owned.filter((svc) => serviceIds.includes(svc.id));
		return await Promise.all(
			mine.map(async (svc) => ({
				id: svc.id,
				status: await DockerService.syncServiceStatus(svc.id),
			})),
		);
	},
);
