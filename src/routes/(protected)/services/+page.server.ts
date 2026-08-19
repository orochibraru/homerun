import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { syncAllServiceStatuses } from "$lib/server/docker/reconcile";
import {
  removeContainer,
  restartContainer,
  startContainer,
  stopContainer,
} from "$lib/server/docker/service";

const logger = new Logger("Services");

async function loadServices(userId: string) {
  const rows = await ServiceDTO.listWithProjectNames(userId);

  await syncAllServiceStatuses(
    rows.filter((r) => r.service.containerId).map((r) => r.service.id)
  );

  const fresh = rows.some((r) => r.service.containerId)
    ? await ServiceDTO.listWithProjectNames(userId)
    : rows;

  return fresh.map((r) => ({
    ...r.service.toJSON(),
    projectName: r.projectName,
  }));
}

export const load = async ({ parent }) => {
  const { user } = await parent();
  const services = await loadServices(user.id);

  return {
    baseDomain: config.baseDomain,
    services,
  };
};

export const actions = {
  delete: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const data = await request.formData();
    const serviceId = data.get("serviceId") as string | null;
    if (!serviceId) {
      return fail(400, { error: "Missing service id." });
    }

    const svc = await ServiceDTO.get(serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }

    if (svc.containerId) {
      try {
        await removeContainer(svc.containerId, { force: true });
      } catch {
        // Container may already be gone on the host — proceed with
        // deleting our record regardless.
      }
    }
    await svc.delete();
    logger.info(`Service deleted: service=${serviceId} user=${locals.user.id}`);
    return { success: true };
  },

  restart: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const data = await request.formData();
    const serviceId = data.get("serviceId") as string | null;
    if (!serviceId) {
      return fail(400, { error: "Missing service id." });
    }

    const svc = await ServiceDTO.get(serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }
    if (!svc.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await restartContainer(svc.containerId);
    logger.info(
      `Service restarted: service=${serviceId} user=${locals.user.id}`
    );
    return { success: true };
  },
  start: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const data = await request.formData();
    const serviceId = data.get("serviceId") as string | null;
    if (!serviceId) {
      return fail(400, { error: "Missing service id." });
    }

    const svc = await ServiceDTO.get(serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }
    if (!svc.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await startContainer(svc.containerId);
    await svc.update({ desiredState: "running" });
    logger.info(`Service started: service=${serviceId} user=${locals.user.id}`);
    return { success: true };
  },

  stop: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const data = await request.formData();
    const serviceId = data.get("serviceId") as string | null;
    if (!serviceId) {
      return fail(400, { error: "Missing service id." });
    }

    const svc = await ServiceDTO.get(serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }
    if (!svc.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await stopContainer(svc.containerId);
    await svc.update({ desiredState: "stopped" });
    logger.info(`Service stopped: service=${serviceId} user=${locals.user.id}`);
    return { success: true };
  },
};
