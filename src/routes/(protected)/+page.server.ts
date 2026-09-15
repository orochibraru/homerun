import { AppLogDTO } from "$lib/dto/app-log-dto";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { UptimeCheckDTO } from "$lib/dto/uptime-check-dto";
import { AdminService } from "$lib/services/admin.service";

export const load = async ({ parent }) => {
	// (protected)/+layout.server.ts already redirects unauthenticated users
	// before this load runs : parent() gives the already-guaranteed user.
	const { user } = await parent();

	const [services, recentDeployments, setupChecks, recentErrors, uptime] =
		await Promise.all([
			ServiceDTO.list(user.id),
			DeploymentDTO.listRecentForUser(user.id),
			AdminService.runSetupChecks(),
			AppLogDTO.listRecent(5),
			UptimeCheckDTO.latestForUser(user.id),
		]);
	const serviceNames = new Map(services.map((svc) => [svc.id, svc.name]));

	const setupIssues = setupChecks.filter((c) => c.severity !== "ok");

	return {
		// Which /settings fields to deep-link + highlight for the current
		// issues : see AdminService.SETUP_CHECK_FIELDS's docstring for why not every issue
		// maps to a field.
		highlightFields: [
			...new Set(
				setupIssues.flatMap((c) => AdminService.SETUP_CHECK_FIELDS[c.id] ?? []),
			),
		],
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
		setupIssues,
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
