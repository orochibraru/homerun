import { fail, redirect } from "@sveltejs/kit";
import { desc, eq } from "drizzle-orm";
import { resolve } from "$app/paths";
import { db } from "$lib/server/db/lib";
import { deployment, service } from "$lib/server/db/schema";
import {
  buildAuthConfig,
  createAndStartContainer,
  pullImage,
  restartContainer,
  startContainer,
  stopContainer,
} from "$lib/server/docker/service";
import { ownedService } from "$lib/server/services";

export const load = async ({ params }) => {
  const deployments = await db
    .select()
    .from(deployment)
    .where(eq(deployment.serviceId, params.serviceId))
    .orderBy(desc(deployment.createdAt))
    .limit(10);

  return { deployments };
};

export const actions = {
  deploy: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ownedService(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }

    const deploymentId = crypto.randomUUID();
    const now = new Date();
    await db.insert(deployment).values({
      createdAt: now,
      id: deploymentId,
      serviceId: svc.id,
      startedAt: now,
      status: "pulling",
      userId: locals.user.id,
    });
    await db
      .update(service)
      .set({ currentStatus: "pulling" })
      .where(eq(service.id, svc.id));

    try {
      const auth = buildAuthConfig(svc);
      const { digest } = await pullImage(svc.image, svc.tag, auth);

      await db
        .update(service)
        .set({ currentStatus: "starting" })
        .where(eq(service.id, svc.id));

      const { containerId } = await createAndStartContainer({
        containerPort: svc.containerPort,
        cpuLimit: svc.cpuLimit,
        envVars: svc.envVars ?? {},
        image: svc.image,
        memoryLimitMb: svc.memoryLimitMb,
        restartPolicy: svc.restartPolicy,
        serviceId: svc.id,
        slug: svc.slug,
        tag: svc.tag,
      });

      await db
        .update(service)
        .set({
          containerId,
          currentStatus: "running",
          desiredState: "running",
        })
        .where(eq(service.id, svc.id));
      await db
        .update(deployment)
        .set({
          containerId,
          finishedAt: new Date(),
          imageDigest: digest,
          status: "running",
        })
        .where(eq(deployment.id, deploymentId));
    } catch (err) {
      await db
        .update(service)
        .set({ currentStatus: "failed" })
        .where(eq(service.id, svc.id));
      await db
        .update(deployment)
        .set({
          errorMessage: err instanceof Error ? err.message : String(err),
          finishedAt: new Date(),
          status: "failed",
        })
        .where(eq(deployment.id, deploymentId));
      return fail(500, {
        error:
          "Deploy failed — check the deployment history below for details.",
      });
    }

    return { success: true };
  },

  restart: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ownedService(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }
    if (!svc.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await restartContainer(svc.containerId);
    return { success: true };
  },

  start: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ownedService(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }
    if (!svc.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await startContainer(svc.containerId);
    await db
      .update(service)
      .set({ desiredState: "running" })
      .where(eq(service.id, svc.id));
    return { success: true };
  },

  stop: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ownedService(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }
    if (!svc.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await stopContainer(svc.containerId);
    await db
      .update(service)
      .set({ desiredState: "stopped" })
      .where(eq(service.id, svc.id));
    return { success: true };
  },
};
