import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { runSetupChecks, SETUP_CHECK_FIELDS } from "$lib/server/setup-checks";
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

  const setupIssues = setupChecks.filter((c) => c.severity !== "ok");

  return {
    // Which /settings fields to deep-link + highlight for the current
    // issues — see SETUP_CHECK_FIELDS's docstring for why not every issue
    // maps to a field.
    highlightFields: [
      ...new Set(setupIssues.flatMap((c) => SETUP_CHECK_FIELDS[c.id] ?? [])),
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
