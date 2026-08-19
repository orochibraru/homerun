import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { startContainer } from "$lib/server/docker/service";

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

  await startContainer(svc.containerId);
  await svc.update({ desiredState: "running" });
  logger.info(
    `Service started via API: service=${svc.id} user=${locals.user.id}`
  );
  return json({ success: true });
};
