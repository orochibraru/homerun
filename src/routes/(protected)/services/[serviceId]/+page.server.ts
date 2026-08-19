import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { Logger } from "$lib/logger";
import {
  buildAuthConfig,
  createAndStartContainer,
  pullImage,
  restartContainer,
  startContainer,
  stopContainer,
} from "$lib/server/docker/service";

const logger = new Logger("Services");

export const load = async ({ params }) => {
  const deployments = await DeploymentDTO.listForService(params.serviceId);

  return { deployments: deployments.map((d) => d.toJSON()) };
};

export const actions = {
  deploy: async ({ params, locals, request }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }

    logger.info(
      `Deploy started: service=${svc.name} (${svc.id}) image=${svc.image}:${svc.tag} user=${locals.user.id}`
    );

    // The client pre-generates this id so it can start polling the
    // progress endpoint immediately, before this request even resolves.
    const formData = await request.formData();
    const clientDeploymentId = formData.get("deploymentId") as string | null;

    const dep = await DeploymentDTO.create({
      id: clientDeploymentId || undefined,
      serviceId: svc.id,
      status: "pulling",
      userId: locals.user.id,
    });
    await svc.update({ currentStatus: "pulling" });

    try {
      const auth = buildAuthConfig(svc);
      const { digest } = await pullImage(svc.image, svc.tag, auth, (line) =>
        dep.appendLog(line)
      );
      logger.info(
        `Image pulled: ${svc.image}:${svc.tag} digest=${digest ?? "unknown"} service=${svc.id}`
      );

      await svc.update({ currentStatus: "starting" });

      const mounts = await ServiceVolumeDTO.listForService(svc.id);
      const project = svc.projectId
        ? await ProjectDTO.get(svc.projectId, locals.user.id)
        : null;

      const { containerId } = await createAndStartContainer(
        {
          containerPort: svc.containerPort,
          cpuLimit: svc.cpuLimit,
          dnsResolvable: svc.dnsResolvable,
          envVars: svc.envVars ?? {},
          image: svc.image,
          memoryLimitMb: svc.memoryLimitMb,
          projectId: svc.projectId,
          projectSlug: project?.slug,
          restartPolicy: svc.restartPolicy,
          serviceId: svc.id,
          slug: svc.slug,
          tag: svc.tag,
          volumes: mounts.map((m) => ({
            containerPath: m.mount.toJSON().containerPath,
            readOnly: m.mount.toJSON().readOnly,
            source: m.volumeSource,
          })),
        },
        (line) => dep.appendLog(line)
      );

      await svc.update({
        containerId,
        currentStatus: "running",
        desiredState: "running",
      });
      await dep.update({
        containerId,
        finishedAt: new Date(),
        imageDigest: digest,
        status: "running",
      });
      logger.info(
        `Deploy succeeded: service=${svc.id} container=${containerId} deployment=${dep.id}`
      );
    } catch (err) {
      await svc.update({ currentStatus: "failed" });
      await dep.update({
        errorMessage: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
        status: "failed",
      });
      logger.error(
        `Deploy failed: service=${svc.id} deployment=${dep.id}`,
        err
      );
      return fail(500, {
        deploymentId: dep.id,
        error:
          "Deploy failed — check the deployment history below for details.",
      });
    }

    return { deploymentId: dep.id, success: true };
  },

  restart: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }
    if (!svc.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await restartContainer(svc.containerId);
    logger.info(`Service restarted: service=${svc.id} user=${locals.user.id}`);
    return { success: true };
  },

  start: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }
    if (!svc.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await startContainer(svc.containerId);
    await svc.update({ desiredState: "running" });
    logger.info(`Service started: service=${svc.id} user=${locals.user.id}`);
    return { success: true };
  },

  stop: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }
    if (!svc.containerId) {
      return fail(400, { error: "This service hasn't been deployed yet." });
    }

    await stopContainer(svc.containerId);
    await svc.update({ desiredState: "stopped" });
    logger.info(`Service stopped: service=${svc.id} user=${locals.user.id}`);
    return { success: true };
  },
};
