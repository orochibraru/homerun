import { phaseLine } from "$lib/deploy-phases";
import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ProjectDTO } from "$lib/dto/project-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { DEPLOY_LOG_SCOPE, Logger } from "$lib/logger";
import { AgentClientService } from "./agent-client.service.ts";
import { serviceHostname, syncDns } from "./dns.service.ts";
import { DockerService, type RemoteHostConnection } from "./docker.service.ts";
import { deployJobPayload } from "./queue/payloads.ts";
import { QueueService } from "./queue.service.ts";

const logger = new Logger(DEPLOY_LOG_SCOPE);

type BuildTarget = Awaited<ReturnType<typeof RemoteHostDTO.resolveBuildTarget>>;
type ServiceMounts = Awaited<
	ReturnType<typeof ServiceVolumeDTO.listForService>
>;

interface DeployContext {
	dep: DeploymentDTO;
	svc: ServiceDTO;
	userId: string;
}

interface BuildPlan {
	auth?: { password: string; serveraddress: string; username: string };
	buildRemote: RemoteHostConnection | undefined;
	buildTarget: BuildTarget;
	cacheRegistryRow: Awaited<ReturnType<typeof BuildCacheRegistryDTO.get>>;
	crossHostBuild: boolean;
	publishedImage: string | null;
}

interface GitBuildOutcome {
	image: string;
	tag: string;
}

interface ResolvedImage {
	digest: string | null;
	image: string;
	tag: string;
}

interface WorkloadContext {
	dep: DeploymentDTO;
	image: string;
	mounts: ServiceMounts;
	project: ProjectDTO | null;
	svc: ServiceDTO;
	swarmMode: boolean;
	tag: string;
}

function syncAutoDns(svc: ServiceDTO, project: ProjectDTO | null): void {
	if (!svc.dnsResolvable) {
		return;
	}
	syncDns(serviceHostname(svc.slug, project?.slug));
}

/** Volume mounts in the shape both the container and swarm create calls want. */
function toVolumeParams(mounts: ServiceMounts) {
	return mounts.map((m) => ({
		containerPath: m.mount.toJSON().containerPath,
		readOnly: m.mount.toJSON().readOnly,
		source: m.volumeSource,
	}));
}

export interface EnqueueDeployInput {
	clientDeploymentId?: string | null;
	dependsOnJobId?: string | null;
	svc: ServiceDTO;
	trigger?: "cron" | "manual";
	userId: string;
}

export interface EnqueueDeployResult {
	deploymentId: string;
	jobId: string;
}

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
	/**
	 * Resolves where the build runs and how its result gets to the deploy
	 * target : the build server (defaulting to the deploy target), the cache
	 * registry credentials, and the published ref when the two differ.
	 */
	async #resolveBuildPlan(
		svc: ServiceDTO,
		userId: string,
		image: string,
	): Promise<BuildPlan> {
		const cacheRegistryRow = svc.buildCacheRegistryId
			? await BuildCacheRegistryDTO.get(svc.buildCacheRegistryId, userId)
			: null;

		const buildServerId = svc.buildServerRemoteHostId;
		const crossHostBuild = !!buildServerId;
		if (crossHostBuild && !cacheRegistryRow) {
			throw new Error(
				"A build server needs a build cache registry configured, to publish the built image through.",
			);
		}

		const buildTarget: BuildTarget = buildServerId
			? await RemoteHostDTO.resolveBuildTarget(buildServerId, userId)
			: { kind: "local" };

		return {
			auth: cacheRegistryRow
				? {
						password: cacheRegistryRow.decryptPassword(),
						serveraddress: cacheRegistryRow.registryUrl,
						username: cacheRegistryRow.username,
					}
				: undefined,
			buildRemote:
				buildTarget.kind === "docker" ? buildTarget.connection : undefined,
			buildTarget,
			cacheRegistryRow,
			crossHostBuild,
			publishedImage: cacheRegistryRow
				? `${cacheRegistryRow.registryUrl}/${image}`
				: null,
		};
	}

	/**
	 * The agent builds and pushes in one call : no separate pushImage step
	 * the way the docker/local path needs, see agent/schemas.ts's
	 * buildInputSchema docstring.
	 */
	async #runAgentBuild(
		ctx: DeployContext,
		plan: BuildPlan,
		ref: string,
		tag: string,
	): Promise<void> {
		const { dep, svc } = ctx;
		const { cacheRegistryRow, crossHostBuild, publishedImage } = plan;
		if (plan.buildTarget.kind !== "agent" || !svc.gitUrl) {
			throw new Error("Agent build called without an agent build target.");
		}

		const push =
			crossHostBuild && cacheRegistryRow && publishedImage
				? {
						password: cacheRegistryRow.decryptPassword(),
						registryUrl: cacheRegistryRow.registryUrl,
						tag: `${publishedImage}:${tag}`,
						username: cacheRegistryRow.username,
					}
				: null;

		const result = await AgentClientService.build(plan.buildTarget.connection, {
			buildContext: svc.gitBuildContext,
			dockerfilePath: svc.gitDockerfilePath,
			gitRef: svc.gitRef,
			gitUrl: svc.gitUrl,
			push,
			tag: ref,
		});
		if (!result.success) {
			throw new Error(result.error ?? "Build failed.");
		}

		// No live progress from the agent (a single response once it's done,
		// not a stream) : one summary line instead of the line-by-line log
		// the local/docker build path gets.
		await dep.appendLog(`Build finished on agent ${plan.buildTarget.hostId}.`);
	}

	/** Clone + build on the local socket or a docker remote, then publish through the cache registry if the build server isn't the deploy target. */
	async #runDockerBuild(
		ctx: DeployContext,
		plan: BuildPlan,
		ref: string,
		tag: string,
	): Promise<void> {
		const { dep, svc } = ctx;
		const { auth, buildRemote, cacheRegistryRow, publishedImage } = plan;
		if (!svc.gitUrl) {
			throw new Error("No git repository URL configured.");
		}

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
				tag: ref,
			},
			(line) => dep.appendLog(line),
		);
		if (!result.success) {
			throw new Error(result.error ?? "Build failed.");
		}

		if (plan.crossHostBuild && cacheRegistryRow && publishedImage && auth) {
			await dep.appendLog(
				`Publishing built image to ${cacheRegistryRow.registryUrl}...`,
			);
			await DockerService.pushImage(
				ref,
				`${publishedImage}:${tag}`,
				auth,
				buildRemote,
			);
		}
	}

	/**
	 * After a cross-host build the deploy target needs the *published* ref,
	 * not the bare local build tag (that only exists on the build server's
	 * own daemon). An agent target pulls it itself as part of its own
	 * /v1/deploy, same as any other registry image.
	 */
	async #pullPublishedImage(
		ctx: DeployContext,
		plan: BuildPlan,
		tag: string,
	): Promise<void> {
		const { dep } = ctx;
		if (!plan.publishedImage) {
			return;
		}
		await dep.appendLog("Pulling published image onto this host...");
		await DockerService.pullImage({
			auth: plan.auth,
			image: plan.publishedImage,
			onProgress: (line) => dep.appendLog(line),
			tag,
		});
	}

	/**
	 * The `buildSource: "git"` path : clone + build (locally, on a docker
	 * remote, or on an agent), publish through the cache registry when the
	 * build server isn't the deploy target, and resolve the image ref the
	 * deploy step should actually use.
	 */
	async #buildGitImage(ctx: DeployContext): Promise<GitBuildOutcome> {
		const { svc, userId } = ctx;
		if (!svc.gitUrl) {
			throw new Error("No git repository URL configured.");
		}

		// A fresh tag per build, same "never reuse a name across deploys"
		// precedent as container names (containers.ts's containerName()), so
		// a build failure never leaves a stale image masquerading as current.
		let image = `homerun-build-${svc.slug}`;
		const tag = Date.now().toString(36);

		const plan = await this.#resolveBuildPlan(svc, userId, image);
		const ref = `${image}:${tag}`;

		if (plan.buildTarget.kind === "agent") {
			await this.#runAgentBuild(ctx, plan, ref, tag);
		} else {
			await this.#runDockerBuild(ctx, plan, ref, tag);
		}

		if (plan.crossHostBuild && plan.publishedImage && plan.auth) {
			await this.#pullPublishedImage(ctx, plan, tag);
			image = plan.publishedImage;
		}

		return { image, tag };
	}

	/** Creates and starts the actual workload : a swarm service, an agent deploy, or a plain local/remote container. */
	async #startWorkload(
		ctx: WorkloadContext,
	): Promise<{ containerId?: string; swarmServiceId?: string }> {
		const { dep, image, mounts, project, svc, tag } = ctx;

		if (ctx.swarmMode) {
			const result = await DockerService.createAndStartSwarmService(
				{
					auth: DockerService.buildAuthConfig(svc),
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
					volumes: toVolumeParams(mounts),
				},
				(line) => dep.appendLog(line),
			);
			return { swarmServiceId: result.swarmServiceId };
		}

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
				restartPolicy: svc.restartPolicy,
				serviceId: svc.id,
				slug: svc.slug,
				tag,
				volumes: toVolumeParams(mounts),
			},
			(line) => dep.appendLog(line),
		);
		return { containerId: result.containerId };
	}

	/**
	 * Resolves the image ref the deploy step should use : a git build, an
	 * agent target that pulls for itself, or an explicit pull here.
	 */
	async #resolveImage(ctx: DeployContext): Promise<ResolvedImage> {
		const { dep, svc } = ctx;

		if (svc.buildSource === "git") {
			const built = await this.#buildGitImage(ctx);
			// Persist the resolved tag immediately : createAndStartContainer,
			// and any future redeploy that reads svc.image/tag before this
			// deploy returns, must see the image that actually exists.
			await svc.update({ image: built.image, tag: built.tag });
			return { digest: "", ...built };
		}

		const { digest } = await DockerService.pullImage({
			auth: DockerService.buildAuthConfig(svc),
			image: svc.image,
			onProgress: (line) => dep.appendLog(line),
			tag: svc.tag,
		});
		logger.info(
			`Image pulled: ${svc.image}:${svc.tag} digest=${digest ?? "unknown"} service=${svc.id}`,
		);
		return { digest, image: svc.image, tag: svc.tag };
	}

	/** Marks the service and deployment failed, notifies, and shapes the caller's DeployResult. */
	async #recordFailure(
		ctx: DeployContext,
		err: unknown,
	): Promise<DeployResult> {
		const { dep, svc, userId } = ctx;
		const errorMessage = err instanceof Error ? err.message : String(err);
		await svc.update({ currentStatus: "failed" });

		// A deploy that fails before any progress line gets appended (an
		// unreachable build server, a missing cache registry,
		// ...) would otherwise leave `dep.log` empty : both the live progress
		// panel and "check the deployment history below" pointed at a blank
		// log with nothing explaining the failure, real gap this closes.
		// errorMessage still carries the same text for the deployment-history
		// panel's own dedicated error display.
		if (!dep.log) {
			await dep.appendLog(errorMessage);
		}
		await dep.update({
			errorMessage,
			finishedAt: new Date(),
			status: "failed",
		});
		logger.error(`Deploy failed: service=${svc.id} deployment=${dep.id}`, err);
		NotificationDTO.notify({
			message: `"${svc.name}" failed to deploy: ${errorMessage}`,
			serviceId: svc.id,
			type: "deploy_failure",
			userId,
		});
		return { deploymentId: dep.id, error: errorMessage, success: false };
	}

	/** Post-start bookkeeping : persist the running state, close out the deployment row, sync DNS, notify. */
	async #recordSuccess(
		ctx: DeployContext,
		ids: { containerId?: string; swarmServiceId?: string },
		digest: string | null,
		project: ProjectDTO | null,
	): Promise<void> {
		const { dep, svc } = ctx;
		const { containerId, swarmServiceId } = ids;

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
		await dep.appendLog(phaseLine("ready"));
		logger.info(
			`Deploy succeeded: service=${svc.id} container=${containerId ?? swarmServiceId} deployment=${dep.id}`,
		);

		syncAutoDns(svc, project);
	}

	async enqueueDeploy(input: EnqueueDeployInput): Promise<EnqueueDeployResult> {
		const { svc, userId } = input;
		const dep = await DeploymentDTO.create({
			id: input.clientDeploymentId || undefined,
			serviceId: svc.id,
			status: "pending",
			userId,
		});
		await svc.update({ currentStatus: "pending" });

		const entry = await QueueService.enqueue({
			dedupeKey: `deploy:${svc.id}`,
			dependsOnJobId: input.dependsOnJobId ?? null,
			lockKey: `service:${svc.id}`,
			payload: {
				deploymentId: dep.id,
				serviceId: svc.id,
				trigger: input.trigger ?? "manual",
				userId,
			},
			serviceId: svc.id,
			title: `Deploy ${svc.name}`,
			type: "deploy",
			userId,
		});

		const coalesced = deployJobPayload.parse(entry.payload).deploymentId;
		if (coalesced !== dep.id) {
			await dep.update({
				errorMessage:
					"Superseded by a deploy that was already queued for this service.",
				finishedAt: new Date(),
				status: "stopped",
			});
			logger.info(
				`Deploy coalesced into queued job: service=${svc.id} job=${entry.id}`,
			);
		}

		return { deploymentId: coalesced, jobId: entry.id };
	}

	async enqueueStackDeploy(
		primary: ServiceDTO,
		linked: ServiceDTO[],
		userId: string,
	): Promise<EnqueueDeployResult> {
		let dependsOnJobId: string | null = null;
		for (const svc of linked) {
			// biome-ignore lint/performance/noAwaitInLoops: each linked service's job id is the next one's dependency, so the chain is built in order
			const enqueued = await this.enqueueDeploy({
				dependsOnJobId,
				svc,
				userId,
			});
			dependsOnJobId = enqueued.jobId;
		}
		return await this.enqueueDeploy({
			dependsOnJobId,
			svc: primary,
			userId,
		});
	}

	async #swarmMode(): Promise<boolean> {
		const instanceSettings = await InstanceSettingsDTO.get();
		return instanceSettings.orchestrationMode === "swarm";
	}

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

		const existing = clientDeploymentId
			? await DeploymentDTO.get(clientDeploymentId)
			: null;
		const dep =
			existing ??
			(await DeploymentDTO.create({
				id: clientDeploymentId || undefined,
				serviceId: svc.id,
				status: "pulling",
				userId,
			}));
		await dep.update({ startedAt: new Date(), status: "pulling" });
		await svc.update({ currentStatus: "pulling" });

		try {
			await dep.appendLog(phaseLine("config"));
			const ctx: DeployContext = { dep, svc, userId };

			await dep.appendLog(phaseLine("volumes"));
			const mounts = await ServiceVolumeDTO.listForService(svc.id);

			await dep.appendLog(phaseLine("image"));
			const { digest, image, tag } = await this.#resolveImage(ctx);

			await svc.update({ currentStatus: "starting" });

			const project = svc.projectId
				? await ProjectDTO.get(svc.projectId, userId)
				: null;

			const swarmMode = await this.#swarmMode();

			await dep.appendLog(phaseLine("container"));
			const ids = await this.#startWorkload({
				dep,
				image,
				mounts,
				project,
				svc,
				swarmMode,
				tag,
			});

			await dep.appendLog(phaseLine("network"));
			await this.#recordSuccess(ctx, ids, digest, project);

			NotificationDTO.notify({
				message:
					trigger === "cron"
						? `"${svc.name}" was auto-redeployed.`
						: `"${svc.name}" deployed successfully.`,
				serviceId: svc.id,
				type: trigger === "cron" ? "auto_redeploy" : "deploy_success",
				userId,
			});

			return {
				containerId: ids.containerId,
				deploymentId: dep.id,
				success: true,
			};
		} catch (err) {
			return await this.#recordFailure({ dep, svc, userId }, err);
		}
	}
}

export const DeploymentService = new DeploymentServiceClass();
