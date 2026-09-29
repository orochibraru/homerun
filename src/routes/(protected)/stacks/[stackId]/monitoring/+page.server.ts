import { resolve } from "$app/paths";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { rangeStart } from "$lib/monitoring-ranges";
import { monitoringRequest } from "$lib/server/monitoring-request";
import { MonitoringService } from "$lib/services/monitoring.service";
import { descendantIds } from "$lib/stack-tree";

export const load = async ({ cookies, parent, url }) => {
	const { stack } = await parent();
	const { range, zone } = monitoringRequest(url, cookies);
	const [stacks, services] = await Promise.all([
		StackDTO.list(),
		ServiceDTO.list(),
	]);
	const stackIds = new Set([
		stack.id,
		...descendantIds(
			stack.id,
			stacks.map((s) => s.toJSON()),
		),
	]);
	const stackNames = new Map(stacks.map((s) => [s.id, s.name]));
	const scoped = services.filter(
		(svc) => svc.stackId && stackIds.has(svc.stackId),
	);
	const serviceIds = scoped.map((svc) => svc.id);
	const [monitoring, breakdown, recentDeployments] = await Promise.all([
		MonitoringService.forScope(
			{ resources: { serviceIds }, serviceIds },
			range,
			zone,
		),
		MonitoringService.breakdown(
			serviceIds,
			rangeStart(range, new Date(), zone),
		),
		DeploymentDTO.listRecentForServices(serviceIds),
	]);
	const byId = new Map(scoped.map((svc) => [svc.id, svc]));

	return {
		monitoring,
		breakdown: breakdown.map((row) => {
			const svc = byId.get(row.serviceId);
			return {
				...row,
				context:
					svc?.stackId && svc.stackId !== stack.id
						? (stackNames.get(svc.stackId) ?? null)
						: null,
				href: resolve("/(protected)/services/[serviceId]/observability", {
					serviceId: row.serviceId,
				}),
				name: svc?.name ?? row.serviceId,
			};
		}),
		recentDeployments: recentDeployments.map((r) => ({
			...r.deployment.toJSON(),
			serviceName: r.serviceName,
			serviceSlug: r.serviceSlug,
		})),
		scopedServices: scoped.map((svc) => ({
			currentStatus: svc.currentStatus,
			id: svc.id,
		})),
		substackCount: stackIds.size - 1,
		zone,
	};
};
