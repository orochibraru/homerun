import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ProjectDTO } from "$lib/dto/project-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { Logger } from "$lib/logger";
import { DockerService } from "./docker.service.ts";

const logger = new Logger("Deploy");

export interface DeployResult {
	containerId?: string;
	deploymentId: string;
	error?: string;
	success: boolean;
}

/**
 * The full build-or-pull → create → start pipeline for one service,
 * shared by the service Overview page's deploy action, the REST API's
 * deploy endpoint, and the cron redeploy scheduler : single source of
 * truth so these three trigger points can't drift out of sync.
 */
export class DeploymentService {
	static async deployService(
		svc: ServiceDTO,
		userId: string,
		clientDeploymentId?: string | null,
	): Promise<DeployResult> {
		const isGitBuild = svc.buildSource === "git";
		logger.info(
			`Deploy started: service=${svc.name} (${svc.id}) source=${svc.buildSource} ${
				isGitBuild
					? `git=${svc.gitUrl}#${svc.gitRef ?? "main"}`
					: `image=${svc.image}:${svc.tag}`
			} user=${userId}`,
		);

		const dep = await DeploymentDTO.create({
			id: clientDeploymentId || undefined,
			serviceId: svc.id,
			status: "pulling",
			userId,
		});
		await svc.update({ currentStatus: "pulling" });

		try {
			let digest: string | null = "";
			let { image, tag } = svc;

			const remote = await RemoteHostDTO.connectionFor(svc, userId);
			// Volumes are host-local, a bind-mount source on this host has no
			// meaning on a remote daemon, so skip attaching them there rather
			// than silently create an empty/wrong mount on the remote side.
			const mounts = remote
				? []
				: await ServiceVolumeDTO.listForService(svc.id);

			if (isGitBuild) {
				if (!svc.gitUrl) {
					throw new Error("No git repository URL configured.");
				}
				// A fresh tag per build, same "never reuse a name across deploys"
				// precedent as container names (containers.ts's containerName()), so
				// a build failure never leaves a stale image masquerading as current.
				image = `homerun-build-${svc.slug}`;
				tag = Date.now().toString(36);

				const result = await DockerService.buildFromGit(
					{
						buildContext: svc.gitBuildContext,
						dockerfilePath: svc.gitDockerfilePath,
						gitRef: svc.gitRef,
						gitUrl: svc.gitUrl,
						remote,
						tag: `${image}:${tag}`,
					},
					(line) => dep.appendLog(line),
				);
				if (!result.success) {
					throw new Error(result.error ?? "Build failed.");
				}
				// Persist the resolved tag immediately, createAndStartContainer
				// below, and any future redeploy that reads svc.image/tag before
				// this function returns, must see the image that actually exists.
				await svc.update({ image, tag });
			} else {
				const auth = DockerService.buildAuthConfig(svc);
				({ digest } = await DockerService.pullImage(
					svc.image,
					svc.tag,
					auth,
					(line) => dep.appendLog(line),
					remote,
				));
				logger.info(
					`Image pulled: ${svc.image}:${svc.tag} digest=${digest ?? "unknown"} service=${svc.id}`,
				);
			}

			await svc.update({ currentStatus: "starting" });

			const project = svc.projectId
				? await ProjectDTO.get(svc.projectId, userId)
				: null;

			const { containerId } = await DockerService.createAndStartContainer(
				{
					authRequired: svc.authRequired,
					containerPort: svc.containerPort,
					cpuLimit: svc.cpuLimit,
					customDomain: svc.customDomain,
					dnsResolvable: svc.dnsResolvable,
					envVars: svc.envVars ?? {},
					image,
					memoryLimitMb: svc.memoryLimitMb,
					networkMode: svc.networkMode,
					portProtocol: svc.portProtocol,
					projectId: svc.projectId,
					projectSlug: project?.slug,
					remote,
					restartPolicy: svc.restartPolicy,
					serviceId: svc.id,
					slug: svc.slug,
					tag,
					volumes: mounts.map((m) => ({
						containerPath: m.mount.toJSON().containerPath,
						readOnly: m.mount.toJSON().readOnly,
						source: m.volumeSource,
					})),
				},
				(line) => dep.appendLog(line),
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
				`Deploy succeeded: service=${svc.id} container=${containerId} deployment=${dep.id}`,
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
			logger.error(
				`Deploy failed: service=${svc.id} deployment=${dep.id}`,
				err,
			);
			return { deploymentId: dep.id, error: errorMessage, success: false };
		}
	}
}
