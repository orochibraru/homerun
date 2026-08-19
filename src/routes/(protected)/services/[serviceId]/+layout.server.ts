import { error } from "@sveltejs/kit";
import { config } from "$lib/config";
import { syncServiceStatus } from "$lib/server/docker/reconcile";
import { ownedService } from "$lib/server/services";

export const load = async ({ params, parent }) => {
  const { user } = await parent();

  const row = await ownedService(params.serviceId, user.id);
  if (!row) {
    error(404, "Service not found");
  }

  if (row.containerId) {
    await syncServiceStatus(row.id);
    const fresh = await ownedService(params.serviceId, user.id);
    return { baseDomain: config.baseDomain, service: fresh ?? row };
  }

  return { baseDomain: config.baseDomain, service: row };
};
