import { monitoringRequest } from "$lib/server/monitoring-request";
import { MonitoringService } from "$lib/services/monitoring.service";

export const load = async ({ cookies, params, url }) => {
	const { range, zone } = monitoringRequest(url, cookies);
	return {
		monitoring: await MonitoringService.forService(
			params.serviceId,
			range,
			zone,
		),
		zone,
	};
};
