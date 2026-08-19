import { json } from "@sveltejs/kit";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { restartContainer } from "$lib/server/docker/service";

const logger = new Logger("API");

export const POST = async ({ params, locals }) => {
  if (!locals.user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
  if (!svc) {
    return json({ error: "Not found" }, { status: 404 });
  }
  if (!svc.containerId) {
    return json(
      { error: "This service hasn't been deployed yet." },
      { status: 400 }
    );
  }

  const remote = await RemoteHostDTO.connectionFor(svc, locals.user.id);
  await restartContainer(svc.containerId, remote);
  logger.info(
    `Service restarted via API: service=${svc.id} user=${locals.user.id}`
  );
  return json({ success: true });
};
