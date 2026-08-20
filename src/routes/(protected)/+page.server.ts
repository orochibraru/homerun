import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { AdminService } from "$lib/services/admin.service";
import { SystemStatsService } from "$lib/services/system-stats.service";

export const load = async ({ parent }) => {
	// (protected)/+layout.server.ts already redirects unauthenticated users
	// before this load runs — parent() gives the already-guaranteed user.
	const { user } = await parent();

	const [services, recentDeployments, systemStats, setupChecks] =
		await Promise.all([
			ServiceDTO.list(user.id),
			DeploymentDTO.listRecentForUser(user.id),
			SystemStatsService.getSystemStats(),
			AdminService.runSetupChecks(),
		]);

	const setupIssues = setupChecks.filter((c) => c.severity !== "ok");

	return {
		// Which /settings fields to deep-link + highlight for the current
		// issues — see AdminService.SETUP_CHECK_FIELDS's docstring for why not every issue
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
		setupIssues,
		stats: {
			running: services.filter((s) => s.currentStatus === "running").length,
			totalServices: services.length,
		},
		systemStats,
	};
};
