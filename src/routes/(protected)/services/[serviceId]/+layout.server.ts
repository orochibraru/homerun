import { error } from "@sveltejs/kit";
import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { syncServiceStatus } from "$lib/server/docker/reconcile";

export const load = async ({ params, parent }) => {
  const { user } = await parent();

  const svc = await ServiceDTO.get(params.serviceId, user.id);
  if (!svc) {
    error(404, "Service not found");
  }

  if (svc.containerId) {
    await syncServiceStatus(svc.id);
    const fresh = await ServiceDTO.get(params.serviceId, user.id);
    return { baseDomain: config.baseDomain, service: (fresh ?? svc).toJSON() };
  }

  return { baseDomain: config.baseDomain, service: svc.toJSON() };
};
