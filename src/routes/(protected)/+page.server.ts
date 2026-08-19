import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { runSetupChecks } from "$lib/server/setup-checks";
import { getSystemStats } from "$lib/server/system-stats";

export const load = async ({ parent }) => {
  // (protected)/+layout.server.ts already redirects unauthenticated users
  // before this load runs — parent() gives the already-guaranteed user.
  const { user } = await parent();

  const [services, recentDeployments, systemStats, setupChecks] =
    await Promise.all([
      ServiceDTO.list(user.id),
      DeploymentDTO.listRecentForUser(user.id),
      getSystemStats(),
      runSetupChecks(),
    ]);

  return {
    recentDeployments: recentDeployments.map((r) => ({
      ...r.deployment.toJSON(),
      serviceName: r.serviceName,
      serviceSlug: r.serviceSlug,
    })),
    setupIssues: setupChecks.filter((c) => c.severity !== "ok"),
    stats: {
      running: services.filter((s) => s.currentStatus === "running").length,
      totalServices: services.length,
    },
    systemStats,
  };
};
