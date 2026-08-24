import { config } from "$lib/config";
import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ProjectDTO } from "$lib/dto/project-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { Logger } from "$lib/logger";
import { AgentClientService } from "./agent-client.service.ts";
import { CloudflareService } from "./cloudflare.service.ts";
import { DockerService } from "./docker.service.ts";
import { PangolinService } from "./pangolin.service.ts";

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
class DeploymentServiceClass {
	async deployService(
		svc: ServiceDTO,
		userId: string,
		clientDeploymentId?: string | null,
		trigger: "manual" | "cron" = "manual",
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
			// Only true for a git build that both built *and* is about to
			// deploy on the exact same agent : the image only exists as a
			// local tag on that one daemon, never published anywhere, so the
			// agent's own /v1/deploy has to skip its normal pull (see
			// agent/schemas.ts's deployInputSchema docstring).
			let skipAgentPull = false;

			const deployTarget = await RemoteHostDTO.resolveTarget(
				svc.remoteHostId,
				userId,
			);
			// The dockerode-shaped connection DockerService's own methods still
			// take directly : undefined for local *and* for an agent target
			// alike (an agent has no raw connection to hand back, see
			// RemoteHostDTO.connectionFor's docstring), only ever set when
			// deployTarget is genuinely `kind: "docker"`.
			const dockerRemote =
				deployTarget.kind === "docker" ? deployTarget.connection : undefined;

			// Volumes are host-local, a bind-mount source on this host has no
			// meaning on a remote daemon (docker *or* agent), so skip attaching
			// them there rather than silently create an empty/wrong mount.
			const mounts =
				deployTarget.kind === "local"
					? await ServiceVolumeDTO.listForService(svc.id)
					: [];

			if (isGitBuild) {
				if (!svc.gitUrl) {
					throw new Error("No git repository URL configured.");
				}
				// A fresh tag per build, same "never reuse a name across deploys"
				// precedent as container names (containers.ts's containerName()), so
				// a build failure never leaves a stale image masquerading as current.
				image = `homerun-build-${svc.slug}`;
				tag = Date.now().toString(36);

				const cacheRegistryRow = svc.buildCacheRegistryId
					? await BuildCacheRegistryDTO.get(svc.buildCacheRegistryId, userId)
					: null;

				// A dedicated build server (Source tab, git mode) different from
				// the deploy target : the build happens on that daemon instead,
				// then (see below, after a successful build) gets published
				// through the cache registry and pulled back onto the deploy
				// target, since the two daemons don't share an image store.
				// Unset : "build where you deploy" is the default, so the build
				// target *is* the deploy target already resolved above, no
				// second lookup needed.
				const buildServerId = svc.buildServerRemoteHostId;
				const crossHostBuild = !!(
					buildServerId && buildServerId !== svc.remoteHostId
				);
				if (crossHostBuild && !cacheRegistryRow) {
					throw new Error(
						"A build server different from the deploy target needs a build cache registry configured, to publish the built image through.",
					);
				}
				const buildTarget = buildServerId
					? await RemoteHostDTO.resolveTarget(buildServerId, userId)
					: deployTarget;
				const buildRemote =
					buildTarget.kind === "docker" ? buildTarget.connection : undefined;

				const auth = cacheRegistryRow
					? {
							password: cacheRegistryRow.decryptPassword(),
							serveraddress: cacheRegistryRow.registryUrl,
							username: cacheRegistryRow.username,
						}
					: undefined;
				const publishedImage = cacheRegistryRow
					? `${cacheRegistryRow.registryUrl}/${image}`
					: null;

				if (buildTarget.kind === "agent") {
					// The agent builds (and, if crossing hosts, pushes) in one
					// call : no separate pushImage step the way the docker/local
					// build path below needs, see agent/schemas.ts's
					// buildInputSchema docstring for why.
					const result = await AgentClientService.build(
						buildTarget.connection,
						{
							buildContext: svc.gitBuildContext,
							dockerfilePath: svc.gitDockerfilePath,
							gitRef: svc.gitRef,
							gitUrl: svc.gitUrl,
							push:
								crossHostBuild && cacheRegistryRow && publishedImage
									? {
											password: cacheRegistryRow.decryptPassword(),
											registryUrl: cacheRegistryRow.registryUrl,
											tag: `${publishedImage}:${tag}`,
											username: cacheRegistryRow.username,
										}
									: null,
							tag: `${image}:${tag}`,
						},
					);
					if (!result.success) {
						throw new Error(result.error ?? "Build failed.");
					}
					// No live progress from the agent (a single response once
					// it's done, not a stream) : one summary line instead of the
					// line-by-line log the local/docker build path gets.
					await dep.appendLog(`Build finished on agent ${buildTarget.hostId}.`);
					skipAgentPull = !crossHostBuild;
				} else {
					const result = await DockerService.buildFromGit(
						{
							buildContext: svc.gitBuildContext,
							cacheRegistry: cacheRegistryRow
								? {
										password: cacheRegistryRow.decryptPassword(),
										registryUrl: cacheRegistryRow.registryUrl,
										username: cacheRegistryRow.username,
									}
								: null,
							dockerfilePath: svc.gitDockerfilePath,
							gitRef: svc.gitRef,
							gitUrl: svc.gitUrl,
							remote: buildRemote,
							tag: `${image}:${tag}`,
						},
						(line) => dep.appendLog(line),
					);
					if (!result.success) {
						throw new Error(result.error ?? "Build failed.");
					}

					if (crossHostBuild && cacheRegistryRow && publishedImage && auth) {
						await dep.appendLog(
							`Publishing built image to ${cacheRegistryRow.registryUrl}...`,
						);
						await DockerService.pushImage(
							`${image}:${tag}`,
							`${publishedImage}:${tag}`,
							auth,
							buildRemote,
						);
					}
				}

				if (crossHostBuild && cacheRegistryRow && publishedImage && auth) {
					// The deploy target now needs the *published* ref, not the
					// bare local build tag (that only exists on the build
					// server's own daemon). An agent deploy target pulls it
					// itself as part of its own /v1/deploy (same as any other
					// registry image) ; a docker/local one needs an explicit
					// pull here first, same as the plain-image path below.
					if (deployTarget.kind !== "agent") {
						await dep.appendLog(
							"Pulling published image onto the deploy target...",
						);
						await DockerService.pullImage(
							publishedImage,
							tag,
							auth,
							(line) => dep.appendLog(line),
							dockerRemote,
						);
					}
					image = publishedImage;
				}

				// Persist the resolved tag immediately, createAndStartContainer
				// below, and any future redeploy that reads svc.image/tag before
				// this function returns, must see the image that actually exists.
				await svc.update({ image, tag });
			} else if (deployTarget.kind === "agent") {
				// The agent pulls this itself as part of its own /v1/deploy
				// below : no separate pull step here (that used to silently
				// fall through to the *local* Docker socket instead, since
				// connectionFor() only ever resolves a docker-kind host, real
				// bug this replaced, see remote-host-dto.ts's resolveTarget).
				digest = null;
			} else {
				const auth = DockerService.buildAuthConfig(svc);
				({ digest } = await DockerService.pullImage(
					svc.image,
					svc.tag,
					auth,
					(line) => dep.appendLog(line),
					dockerRemote,
				));
				logger.info(
					`Image pulled: ${svc.image}:${svc.tag} digest=${digest ?? "unknown"} service=${svc.id}`,
				);
			}

			await svc.update({ currentStatus: "starting" });

			const project = svc.projectId
				? await ProjectDTO.get(svc.projectId, userId)
				: null;

			const instanceSettings = await InstanceSettingsDTO.get();
			const swarmMode = instanceSettings.orchestrationMode === "swarm";
			if (swarmMode && deployTarget.kind !== "local") {
				throw new Error(
					"Swarm mode services can only be deployed locally : Remote Hosts (a separate Docker daemon, or a Homerun Agent) aren't part of this instance's swarm cluster. Clear the deploy target first.",
				);
			}

			let containerId: string | undefined;
			let swarmServiceId: string | undefined;

			if (swarmMode) {
				const auth = DockerService.buildAuthConfig(svc);
				const result = await DockerService.createAndStartSwarmService(
					{
						auth,
						authRequired: svc.authRequired,
						containerPort: svc.containerPort,
						cpuLimit: svc.cpuLimit,
						customDomain: svc.customDomain,
						dnsResolvable: svc.dnsResolvable,
						envVars: svc.envVars ?? {},
						image,
						memoryLimitMb: svc.memoryLimitMb,
						portProtocol: svc.portProtocol,
						projectSlug: project?.slug,
						replicas: svc.replicas,
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
				swarmServiceId = result.swarmServiceId;
			} else if (deployTarget.kind === "agent") {
				const registryAuth = DockerService.buildAuthConfig(svc);
				const result = await AgentClientService.deploy(
					deployTarget.connection,
					{
						containerPort: svc.containerPort,
						cpuLimit: svc.cpuLimit ? Number.parseFloat(svc.cpuLimit) : null,
						envVars: svc.envVars ?? {},
						image,
						memoryLimitMb: svc.memoryLimitMb,
						networkMode: svc.networkMode,
						portProtocol: svc.portProtocol,
						registryAuth,
						restartPolicy: svc.restartPolicy,
						serviceId: svc.id,
						skipPull: skipAgentPull,
						slug: svc.slug,
						tag,
					},
				);
				for (const line of result.log) {
					await dep.appendLog(line);
				}
				containerId = result.containerId;
			} else {
				const result = await DockerService.createAndStartContainer(
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
						remote: dockerRemote,
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
				containerId = result.containerId;
			}

			await svc.update({
				containerId: containerId ?? null,
				currentStatus: "running",
				desiredState: "running",
				swarmServiceId: swarmServiceId ?? null,
			});

			await dep.update({
				containerId: containerId ?? swarmServiceId,
				finishedAt: new Date(),
				imageDigest: digest,
				status: "running",
			});
			logger.info(
				`Deploy succeeded: service=${svc.id} container=${containerId ?? swarmServiceId} deployment=${dep.id}`,
			);

			// Auto-DNS (Cloudflare and/or Pangolin) : only meaningful for a
			// service actually routed through this host's own Traefik (shared
			// network + DNS-resolvable), a remote-hosted service (docker *or*
			// agent) has no Traefik routing at all (see docker/labels.ts), so
			// there's no hostname to point anywhere. Fire-and-forget,
			// best-effort, both independent : see CloudflareService.syncDnsRecord's
			// and PangolinService.syncDnsRecord's own docstrings.
			if (svc.dnsResolvable && deployTarget.kind === "local") {
				const hostname = `${project?.slug ? `${project.slug}-${svc.slug}` : svc.slug}.${config.baseDomain}`;
				CloudflareService.syncDnsRecord(hostname, config.baseDomain).catch(
					() => {
						// Never throws (see its own docstring), this catch is just
						// defense in depth.
					},
				);
				PangolinService.syncDnsRecord(hostname).catch(() => {
					// Never throws (see its own docstring), this catch is just
					// defense in depth.
				});
			}

			NotificationDTO.notify({
				message:
					trigger === "cron"
						? `"${svc.name}" was auto-redeployed.`
						: `"${svc.name}" deployed successfully.`,
				serviceId: svc.id,
				type: trigger === "cron" ? "auto_redeploy" : "deploy_success",
				userId,
			});

			return { containerId, deploymentId: dep.id, success: true };
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			await svc.update({ currentStatus: "failed" });
			// A deploy that fails before any progress line gets appended (an
			// unreachable agent/remote host, a resolveTarget() lookup
			// failure, ...) would otherwise leave `dep.log` empty : both the
			// live progress panel and "check the deployment history below"
			// pointed at a blank log with nothing explaining the failure,
			// real gap this closes. errorMessage (below) still carries the
			// same text for the deployment-history panel's own dedicated
			// error display.
			if (!dep.log) {
				await dep.appendLog(errorMessage);
			}
			await dep.update({
				errorMessage,
				finishedAt: new Date(),
				status: "failed",
			});
			logger.error(
				`Deploy failed: service=${svc.id} deployment=${dep.id}`,
				err,
			);
			NotificationDTO.notify({
				message: `"${svc.name}" failed to deploy: ${errorMessage}`,
				serviceId: svc.id,
				type: "deploy_failure",
				userId,
			});
			return { deploymentId: dep.id, error: errorMessage, success: false };
		}
	}
}

export const DeploymentService = new DeploymentServiceClass();
