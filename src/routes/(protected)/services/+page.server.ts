import { fail, redirect } from "@sveltejs/kit";
import { desc, eq } from "drizzle-orm";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import { db } from "$lib/server/db/lib";
import { project, service } from "$lib/server/db/schema";
import { syncAllServiceStatuses } from "$lib/server/docker/reconcile";
import {
  removeContainer,
  restartContainer,
  startContainer,
  stopContainer,
} from "$lib/server/docker/service";
import { ownedService } from "$lib/server/services";

const logger = new Logger("Services");

async function loadServices(userId: string) {
  const query = () =>
    db
      .select({
        projectName: project.name,
        service,
      })
      .from(service)
      .leftJoin(project, eq(service.projectId, project.id))
      .where(eq(service.userId, userId))
      .orderBy(desc(service.createdAt));

  const rows = await query();

  await syncAllServiceStatuses(
    rows.filter((r) => r.service.containerId).map((r) => r.service.id)
  );

  const fresh = rows.some((r) => r.service.containerId) ? await query() : rows;

  return fresh.map((r) => ({ ...r.service, projectName: r.projectName }));
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

    const row = await ownedService(serviceId, locals.user.id);
    if (!row) {
      return fail(404, { error: "Service not found." });
    }

    if (row.containerId) {
      try {
        await removeContainer(row.containerId, { force: true });
      } catch {
        // Container may already be gone on the host — proceed with
        // deleting our record regardless.
      }
    }
    await db.delete(service).where(eq(service.id, serviceId));
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

    const row = await ownedService(serviceId, locals.user.id);
    if (!row) {
      return fail(404, { error: "Service not found." });
    }
    if (!row.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await restartContainer(row.containerId);
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

    const row = await ownedService(serviceId, locals.user.id);
    if (!row) {
      return fail(404, { error: "Service not found." });
    }
    if (!row.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await startContainer(row.containerId);
    await db
      .update(service)
      .set({ desiredState: "running" })
      .where(eq(service.id, serviceId));
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

    const row = await ownedService(serviceId, locals.user.id);
    if (!row) {
      return fail(404, { error: "Service not found." });
    }
    if (!row.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await stopContainer(row.containerId);
    await db
      .update(service)
      .set({ desiredState: "stopped" })
      .where(eq(service.id, serviceId));
    logger.info(`Service stopped: service=${serviceId} user=${locals.user.id}`);
    return { success: true };
  },
};
