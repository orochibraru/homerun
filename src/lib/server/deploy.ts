import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ProjectDTO } from "$lib/dto/project-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { Logger } from "$lib/logger";
import {
  buildAuthConfig,
  createAndStartContainer,
  pullImage,
} from "$lib/server/docker/service";

const logger = new Logger("Deploy");

export interface DeployResult {
  containerId?: string;
  deploymentId: string;
  error?: string;
  success: boolean;
}

/**
 * The full pull → create → start pipeline for one service, shared by the
 * service Overview page's deploy action, the REST API's deploy endpoint,
 * and (future) the cron redeploy scheduler — single source of truth so
 * these three trigger points can't drift out of sync.
 */
export async function deployService(
  svc: ServiceDTO,
  userId: string,
  clientDeploymentId?: string | null
): Promise<DeployResult> {
  logger.info(
    `Deploy started: service=${svc.name} (${svc.id}) image=${svc.image}:${svc.tag} user=${userId}`
  );

  const dep = await DeploymentDTO.create({
    id: clientDeploymentId || undefined,
    serviceId: svc.id,
    status: "pulling",
    userId,
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
      ? await ProjectDTO.get(svc.projectId, userId)
      : null;

    const { containerId } = await createAndStartContainer(
      {
        authRequired: svc.authRequired,
        containerPort: svc.containerPort,
        cpuLimit: svc.cpuLimit,
        customDomain: svc.customDomain,
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

    return { containerId, deploymentId: dep.id, success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await svc.update({ currentStatus: "failed" });
    await dep.update({
      errorMessage,
      finishedAt: new Date(),
      status: "failed",
    });
    logger.error(`Deploy failed: service=${svc.id} deployment=${dep.id}`, err);
    return { deploymentId: dep.id, error: errorMessage, success: false };
  }
}
