import { AppLogDTO } from "$lib/dto/app-log-dto";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { UptimeCheckDTO } from "$lib/dto/uptime-check-dto";

export const load = async ({ locals, parent }) => {
	// (protected)/+layout.server.ts already redirects unauthenticated users
	// before this load runs : parent() gives the already-guaranteed user.
	await parent();

	const [services, recentDeployments, uptime] = await Promise.all([
		ServiceDTO.list(),
		DeploymentDTO.listRecent(),
		UptimeCheckDTO.latest(),
	]);
	const recentErrors = locals.isAdmin
		? await AppLogDTO.listRecent(5)
		: await AppLogDTO.listRecentForServices(
				services.map((svc) => svc.id),
				5,
			);
	const serviceNames = new Map(services.map((svc) => [svc.id, svc.name]));

	return {
		isAdmin: locals.isAdmin,
		recentDeployments: recentDeployments.map((r) => ({
			...r.deployment.toJSON(),
			serviceName: r.serviceName,
			serviceSlug: r.serviceSlug,
		})),
		recentErrors: recentErrors.map((log) => {
			const row = log.toJSON();
			return {
				createdAt: row.createdAt,
				id: row.id,
				level: row.level,
				message: row.message,
				scope: row.scope,
				serviceId: row.serviceId,
				serviceName: row.serviceId
					? (serviceNames.get(row.serviceId) ?? null)
					: null,
			};
		}),
		stats: {
			running: services.filter((s) => s.currentStatus === "running").length,
			totalServices: services.length,
		},
		// One row per failing probe, newest first : the dashboard shows what's
		// down, not a roll-call of everything that's fine.
		uptimeDown: uptime
			.filter((check) => !check.ok)
			.map((check) => ({
				detail: check.detail,
				kind: check.kind,
				serviceId: check.serviceId,
				serviceName: serviceNames.get(check.serviceId) ?? "Unknown service",
			})),
		uptimeProbes: uptime.length,
	};
};
