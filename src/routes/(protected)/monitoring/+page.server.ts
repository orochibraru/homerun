import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { rangeStart } from "$lib/monitoring-ranges";
import { monitoringRequest } from "$lib/server/monitoring-request";
import { MonitoringService } from "$lib/services/monitoring.service";

export const load = async ({ cookies, url }) => {
	const { range, zone } = monitoringRequest(url, cookies);
	const services = await ServiceDTO.listWithStackNames();
	const serviceIds = services.map(({ service }) => service.id);
	const [monitoring, breakdown] = await Promise.all([
		MonitoringService.forScope({ resources: "host", serviceIds }, range, zone),
		MonitoringService.breakdown(
			serviceIds,
			rangeStart(range, new Date(), zone),
		),
	]);
	const byId = new Map(services.map((row) => [row.service.id, row]));
	return {
		monitoring,
		breakdown: breakdown.map((row) => ({
			...row,
			context: byId.get(row.serviceId)?.stackName ?? null,
			href: resolve("/(protected)/services/[serviceId]/observability", {
				serviceId: row.serviceId,
			}),
			name: byId.get(row.serviceId)?.service.name ?? row.serviceId,
		})),
		zone,
	};
};
