import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { getSystemStats } from "$lib/server/system-stats";

export const load = async ({ parent }) => {
  // (protected)/+layout.server.ts already redirects unauthenticated users
  // before this load runs — parent() gives the already-guaranteed user.
  const { user } = await parent();

  const [services, recentDeployments, systemStats] = await Promise.all([
    ServiceDTO.list(user.id),
    DeploymentDTO.listRecentForUser(user.id),
    getSystemStats(),
  ]);

  return {
    recentDeployments: recentDeployments.map((r) => ({
      ...r.deployment.toJSON(),
      serviceName: r.serviceName,
      serviceSlug: r.serviceSlug,
    })),
    stats: {
      running: services.filter((s) => s.currentStatus === "running").length,
      totalServices: services.length,
    },
    systemStats,
  };
};
