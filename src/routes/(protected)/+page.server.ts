import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";

export const load = async ({ parent }) => {
  // (protected)/+layout.server.ts already redirects unauthenticated users
  // before this load runs — parent() gives the already-guaranteed user.
  const { user } = await parent();

  const [services, recentDeployments] = await Promise.all([
    ServiceDTO.list(user.id),
    DeploymentDTO.listRecentForUser(user.id),
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
  };
};
