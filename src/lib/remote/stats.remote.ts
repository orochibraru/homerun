import { z } from "zod";
import { query } from "$app/server";
import { ServiceDTO } from "$lib/dto/service-dto";
import {
	type StatPoint,
	type StatRange,
	StatSampleDTO,
} from "$lib/dto/stat-sample-dto";
import { requireUser } from "$lib/server/remote-auth";
import { DockerService, type SwarmReplica } from "$lib/services/docker.service";

const rangeSchema = z.enum([
	"live",
	"hour",
	"day",
	"week",
	"month",
	"year",
	"all",
]);

const historyInput = z.object({
	range: rangeSchema,
	serviceId: z.string().nullable().default(null),
});

export interface ServiceUsage {
	cpuPercent: number;
	id: string;
	memUsedMb: number;
	name: string;
	netRxBytes: number;
	netTxBytes: number;
	status: string;
}

export const getStatHistory = query(
	historyInput,
	async ({ range, serviceId }): Promise<StatPoint[]> => {
		requireUser();
		if (serviceId) {
			const svc = await ServiceDTO.get(serviceId);
			if (!svc) {
				return [];
			}
		}
		return await StatSampleDTO.history(range as StatRange, serviceId);
	},
);

/** Every service the caller owns with its newest sample, for the dashboard's sortable usage table. */
export const getServiceUsage = query(async (): Promise<ServiceUsage[]> => {
	requireUser();
	const [services, latest] = await Promise.all([
		ServiceDTO.list(),
		StatSampleDTO.latestPerService(),
	]);
	return services.map((svc) => {
		const sample = latest.get(svc.id);
		return {
			cpuPercent: sample?.cpuPercent ?? 0,
			id: svc.id,
			memUsedMb: sample?.memUsedMb ?? 0,
			name: svc.name,
			netRxBytes: sample?.netRxBytes ?? 0,
			netTxBytes: sample?.netTxBytes ?? 0,
			status: svc.currentStatus,
		};
	});
});

/** Every replica of a swarm-mode service, with live stats for the ones on this host. Empty for a standalone service. */
export const getReplicaStats = query(
	z.string(),
	async (serviceId): Promise<SwarmReplica[]> => {
		requireUser();
		const svc = await ServiceDTO.get(serviceId);
		if (!svc?.swarmServiceId) {
			return [];
		}
		return await DockerService.listSwarmReplicas(svc.swarmServiceId);
	},
);
