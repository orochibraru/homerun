import { z } from "zod";
import { query } from "$app/server";
import { ServiceDTO } from "$lib/dto/service-dto";
import {
	type StatPoint,
	type StatRange,
	StatSampleDTO,
} from "$lib/dto/stat-sample-dto";
import { requireUser } from "$lib/server/remote-auth";

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
		const user = requireUser();
		if (serviceId) {
			const svc = await ServiceDTO.get(serviceId, user.id);
			if (!svc) {
				return [];
			}
		}
		return await StatSampleDTO.history(range as StatRange, serviceId);
	},
);

/** Every service the caller owns with its newest sample, for the dashboard's sortable usage table. */
export const getServiceUsage = query(async (): Promise<ServiceUsage[]> => {
	const user = requireUser();
	const [services, latest] = await Promise.all([
		ServiceDTO.list(user.id),
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
