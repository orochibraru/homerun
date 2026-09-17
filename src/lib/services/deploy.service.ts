import { phaseLine } from "$lib/deploy-phases";
import type { DeployTrigger } from "$lib/deploy-trigger";
import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { DEPLOY_LOG_SCOPE, Logger } from "$lib/logger";
import { AgentClientService } from "./agent-client.service.ts";
import {
	registryAuth,
	resolveGitCredential,
	type ServiceMounts,
	syncAutoDns,
	toVolumeParams,
} from "./deploy/helpers.ts";
import {
	type BuildServer,
	type CacheRegistryCredentials,
	type DeployPlan,
	type GitBuildPlan,
	type GitSource,
	type RevisionSource,
	resolveDeployPlan,
	unreachable,
	type WorkloadPlan,
} from "./deploy/plan.ts";
import { pullForDeploy } from "./deploy/pull-step.ts";
import { resolveRevisionImage } from "./deploy/revision-step.ts";
import {
	enforceStatusChecks,
	notifyStatusChecksFailed,
	StatusChecksFailedError,
} from "./deploy/status-check-step.ts";
import { DockerService, type RemoteHostConnection } from "./docker.service.ts";
import {
	ImageScanBlockedError,
	ImageScanService,
} from "./image-scan.service.ts";
import { NotificationChannelService } from "./notification-channel.service.ts";
import { deployJobPayload } from "./queue/payloads.ts";
import { QueueService } from "./queue.service.ts";
import { RevisionHealthService } from "./revision-health.service.ts";

const logger = new Logger(DEPLOY_LOG_SCOPE);

interface DeployContext {
	dep: DeploymentDTO;
	svc: ServiceDTO;
	userId: string;
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
	plan: WorkloadPlan;
	stack: StackDTO | null;
	svc: ServiceDTO;
	tag: string;
}

export interface EnqueueDeployInput {
	clientDeploymentId?: string | null;
	dependsOnJobId?: string | null;
	rollbackOfDeploymentId?: string | null;
	svc: ServiceDTO;
	trigger?: DeployTrigger;
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
 * Builds the `RevisionSource` a rollback deploy should reuse, by loading the
 * deployment being rolled back to. Returns null when `dep` isn't a rollback
 * (`rollbackOfDeploymentId` unset).
 *
 * @throws When the target deployment's row is gone or never recorded an
 *   image ref, since there's nothing left to roll back to.
 */
async function revisionSourceFor(
	dep: DeploymentDTO,
): Promise<RevisionSource | null> {
	if (!dep.rollbackOfDeploymentId) {
		return null;
	}
	const revision = await DeploymentDTO.get(dep.rollbackOfDeploymentId);
	const row = revision?.toJSON();
	if (!row?.imageRef) {
		throw new Error("The revision to roll back to no longer exists.");
	}
	return {
		buildSource: row.buildSource ?? "image",
		digest: row.imageDigest,
		gitCommit: row.gitCommit,
		gitRef: row.gitRef,
		id: row.id,
		imageId: row.imageId,
		imageRef: row.imageRef,
	};
}

class DeploymentServiceClass {
	/**
	 * Assembles the `DeployPlan` for a deploy: loads instance settings, the
	 * build cache registry and build server the service is configured to use
	 * (only relevant for a fresh git build, not a rollback), then delegates
	 * the actual image/workload decision to `resolveDeployPlan`.
	 *
	 * @param revision When set (a rollback), skips build-server/cache-registry
	 *   resolution entirely and the plan reuses that revision's image.
	 */
	async #loadDeployPlan(
		svc: ServiceDTO,
		userId: string,
		revision: RevisionSource | null,
	): Promise<DeployPlan> {
		const settings = await InstanceSettingsDTO.get();
		const isGitBuild = svc.buildSource === "git" && !revision;

		const cacheRegistryRow =
			isGitBuild && svc.buildCacheRegistryId
				? await BuildCacheRegistryDTO.get(svc.buildCacheRegistryId, userId)
				: null;
		const cacheRegistry: CacheRegistryCredentials | null = cacheRegistryRow
			? {
					password: cacheRegistryRow.decryptPassword(),
					registryUrl: cacheRegistryRow.registryUrl,
					username: cacheRegistryRow.username,
				}
			: null;

		let buildServer: BuildServer | null = null;
		if (isGitBuild && svc.buildServerRemoteHostId && cacheRegistry) {
			const target = await RemoteHostDTO.resolveBuildTarget(
				svc.buildServerRemoteHostId,
				userId,
			);
			buildServer = target.kind === "local" ? null : target;
		}

		return resolveDeployPlan({
			buildServer,
			cacheRegistry,
			orchestrationMode: settings.orchestrationMode,
			revision,
			service: svc.toJSON(),
		});
	}

	/** Clone + build on the local socket or a docker remote. */
	async #runDockerBuild(
		ctx: DeployContext,
		git: GitSource,
		target: {
			cacheRegistry: CacheRegistryCredentials | null;
			commit: string | null;
			remote?: RemoteHostConnection;
		},
		ref: string,
	): Promise<void> {
		const { dep } = ctx;
		const result = await DockerService.buildFromGit(
			{
				buildContext: git.buildContext,
				cacheRegistry: target.cacheRegistry,
				commit: target.commit,
				credential: await resolveGitCredential(git.gitUrl, ctx.userId),
				dockerfilePath: git.dockerfilePath,
				gitRef: git.gitRef,
				gitUrl: git.gitUrl,
				remote: target.remote,
				tag: ref,
			},
			(line) => dep.appendLog(line),
		);
		if (!result.success) {
			throw new Error(result.error ?? "Build failed.");
		}
		await dep.update({
			gitCommit: result.commit ?? null,
			gitRef: git.gitRef ?? null,
		});
	}

	/**
	 * The agent builds and pushes in one call : no separate pushImage step
	 * the way the docker/local path needs, see agent/schemas.ts's
	 * buildInputSchema docstring.
	 */
	async #runAgentBuild(
		ctx: DeployContext,
		plan: Extract<GitBuildPlan, { kind: "agent-build" }>,
		ref: string,
		publishedRef: string,
	): Promise<void> {
		const { dep } = ctx;
		const { git, registry, server } = plan;

		const result = await AgentClientService.build(server.connection, {
			buildContext: git.buildContext,
			credential: await resolveGitCredential(git.gitUrl, ctx.userId),
			dockerfilePath: git.dockerfilePath,
			gitRef: git.gitRef,
			gitUrl: git.gitUrl,
			push: {
				password: registry.password,
				registryUrl: registry.registryUrl,
				tag: publishedRef,
				username: registry.username,
			},
			tag: ref,
		});
		if (!result.success) {
			throw new Error(result.error ?? "Build failed.");
		}

		// No live progress from the agent (a single response once it's done,
		// not a stream) : one summary line instead of the line-by-line log
		// the local/docker build path gets.
		await dep.appendLog(`Build finished on agent ${server.hostId}.`);
	}

	/**
	 * After a cross-host build the deploy target needs the *published* ref,
	 * not the bare local build tag (that only exists on the build server's
	 * own daemon).
	 */
	async #pullPublishedImage(
		ctx: DeployContext,
		registry: CacheRegistryCredentials,
		publishedImage: string,
		tag: string,
	): Promise<void> {
		const { dep } = ctx;
		await dep.appendLog("Pulling published image onto this host...");
		await DockerService.pullImage({
			auth: registryAuth(registry),
			image: publishedImage,
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
	async #buildGitImage(
		ctx: DeployContext,
		plan: GitBuildPlan,
		commit: string | null,
	): Promise<GitBuildOutcome> {
		// A fresh tag per build, same "never reuse a name across deploys"
		// precedent as container names (containers.ts's containerName()), so
		// a build failure never leaves a stale image masquerading as current.
		const image = `homerun-build-${ctx.svc.slug}`;
		const tag = Date.now().toString(36);
		const ref = `${image}:${tag}`;

		switch (plan.kind) {
			case "local-build":
				await this.#runDockerBuild(
					ctx,
					plan.git,
					{ cacheRegistry: plan.cacheRegistry, commit },
					ref,
				);
				return { image, tag };
			case "docker-build": {
				const publishedImage = `${plan.registry.registryUrl}/${image}`;
				await this.#runDockerBuild(
					ctx,
					plan.git,
					{
						cacheRegistry: plan.registry,
						commit,
						remote: plan.server.connection,
					},
					ref,
				);
				await ctx.dep.appendLog(
					`Publishing built image to ${plan.registry.registryUrl}...`,
				);
				await DockerService.pushImage(
					ref,
					`${publishedImage}:${tag}`,
					registryAuth(plan.registry),
					plan.server.connection,
				);
				await this.#pullPublishedImage(ctx, plan.registry, publishedImage, tag);
				return { image: publishedImage, tag };
			}
			case "agent-build": {
				const publishedImage = `${plan.registry.registryUrl}/${image}`;
				if (commit) {
					await ctx.dep.appendLog(
						`An agent build clones the head of ${plan.git.gitRef ?? "main"}, which may have moved past the checked commit ${commit.slice(0, 7)}.`,
					);
				}
				await this.#runAgentBuild(ctx, plan, ref, `${publishedImage}:${tag}`);
				await this.#pullPublishedImage(ctx, plan.registry, publishedImage, tag);
				return { image: publishedImage, tag };
			}
			default:
				return unreachable(plan);
		}
	}

	/** Creates and starts the actual workload : a swarm service or a plain container. */
	async #startWorkload(
		ctx: WorkloadContext,
	): Promise<{ containerId?: string; swarmServiceId?: string }> {
		const { dep, image, mounts, plan, stack, svc, tag } = ctx;
		const shared = {
			authRequired: svc.authRequired,
			containerPort: svc.containerPort,
			cpuLimit: svc.cpuLimit,
			customDomain: svc.customDomain,
			dnsResolvable: svc.dnsResolvable,
			envVars: svc.envVars ?? {},
			healthcheckCommand: svc.healthcheckCommand,
			image,
			memoryLimitMb: svc.memoryLimitMb,
			portProtocol: svc.portProtocol,
			restartPolicy: svc.restartPolicy,
			serviceId: svc.id,
			slug: svc.slug,
			stackSlug: stack?.slug,
			tag,
			volumes: toVolumeParams(mounts),
		};
		const onLog = (line: string) => dep.appendLog(line);

		switch (plan.kind) {
			case "swarm": {
				const result = await DockerService.createAndStartSwarmService(
					{
						...shared,
						auth: DockerService.buildAuthConfig(svc),
						replicas: plan.replicas,
					},
					onLog,
				);
				return { swarmServiceId: result.swarmServiceId };
			}
			case "container": {
				const result = await DockerService.createAndStartContainer(
					{ ...shared, networkMode: plan.networkMode, stackId: svc.stackId },
					onLog,
				);
				return { containerId: result.containerId };
			}
			default:
				return unreachable(plan);
		}
	}

	/**
	 * Resolves the image ref the deploy step should use : a plain registry
	 * pull, a rollback's already-built revision image, or a fresh git build
	 * (local, docker build server, or agent). A git build also runs required
	 * status checks first when configured, triggers an image scan on the
	 * result, and persists the resolved image/tag onto the service row
	 * immediately so a concurrent redeploy sees it.
	 */
	async #resolveImage(
		ctx: DeployContext,
		plan: DeployPlan,
	): Promise<ResolvedImage> {
		const imagePlan = plan.image;
		switch (imagePlan.kind) {
			case "pull":
				return await pullForDeploy(ctx, imagePlan, plan.workload);
			case "revision":
				return await resolveRevisionImage(
					ctx,
					imagePlan.revision,
					plan.workload,
				);
			case "local-build":
			case "docker-build":
			case "agent-build": {
				const commit = ctx.svc.toJSON().requireStatusChecks
					? await enforceStatusChecks(ctx, imagePlan.git)
					: null;
				const built = await this.#buildGitImage(ctx, imagePlan, commit);
				await ImageScanService.scanBuilt(ctx, imagePlan, built);
				// Persist the resolved tag immediately : createAndStartContainer,
				// and any future redeploy that reads svc.image/tag before this
				// deploy returns, must see the image that actually exists.
				await ctx.svc.update({ image: built.image, tag: built.tag });
				return { digest: null, ...built };
			}
			default:
				return unreachable(imagePlan);
		}
	}
	/** Marks the deployment failed (and the service too, unless a status-check or image-scan block left its previous workload running), notifies, and shapes the caller's DeployResult. */
	async #recordFailure(
		ctx: DeployContext,
		err: unknown,
		trigger: DeployTrigger,
	): Promise<DeployResult> {
		const { dep, svc, userId } = ctx;
		const errorMessage = err instanceof Error ? err.message : String(err);
		const checksFailed = err instanceof StatusChecksFailedError;
		const keptRunning = checksFailed || err instanceof ImageScanBlockedError;
		if (keptRunning && (svc.containerId || svc.swarmServiceId)) {
			await DockerService.syncServiceStatus(svc.id);
		} else {
			await svc.update({ currentStatus: "failed" });
		}

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
		if (checksFailed) {
			await notifyStatusChecksFailed(svc, userId, err);
			return { deploymentId: dep.id, error: errorMessage, success: false };
		}
		NotificationDTO.notify({
			message: `"${svc.name}" failed to deploy: ${errorMessage}`,
			serviceId: svc.id,
			type: "deploy_failure",
			userId,
		});
		NotificationChannelService.notifyDeploy({ dep, ok: false, svc, trigger });
		return { deploymentId: dep.id, error: errorMessage, success: false };
	}

	/**
	 * Post-start bookkeeping once the container/swarm service is running :
	 * marks the service and deployment rows running, clears any dismissed
	 * error state on the service, appends the closing log line, and syncs
	 * DNS for the service's hostname(s). Doesn't notify : the caller
	 * (`deployService`) does that itself once this returns.
	 */
	async #recordSuccess(
		ctx: DeployContext,
		ids: { containerId?: string; swarmServiceId?: string },
		resolved: ResolvedImage,
		stack: StackDTO | null,
	): Promise<void> {
		const { dep, svc } = ctx;
		const { containerId, swarmServiceId } = ids;
		const [plainTag, pinnedDigest] = resolved.tag.split("@");
		const runRef = `${resolved.image}:${resolved.tag}`;

		await svc.update({
			containerId: containerId ?? null,
			currentStatus: "running",
			desiredState: "running",
			// A revision that reached "running" clears the errors that came
			// before it : whatever they were, this deploy is the answer.
			errorsDismissedAt: new Date(),
			errorsDismissedByDeploymentId: dep.id,
			swarmServiceId: swarmServiceId ?? null,
		});
		await dep.update({
			buildSource: dep.toJSON().buildSource ?? svc.buildSource,
			containerId: containerId ?? swarmServiceId,
			finishedAt: new Date(),
			health: "watching",
			imageDigest: resolved.digest || pinnedDigest || null,
			imageId: await DockerService.localImageId(runRef),
			imageRef: `${resolved.image}:${plainTag}`,
			status: "running",
		});
		await dep.appendLog(phaseLine("ready"));
		logger.info(
			`Deploy succeeded: service=${svc.id} container=${containerId ?? swarmServiceId} deployment=${dep.id}`,
		);

		await syncAutoDns(svc, stack, dep);
	}

	/**
	 * Starts watching a just-deployed revision for health, so an unhealthy
	 * container/swarm service can trigger an automatic rollback. Wires the
	 * rollback callback back through `enqueueDeploy`, so an auto-rollback goes
	 * through the same queue/coalescing path a manual deploy does.
	 */
	watchHealth(deploymentId: string, serviceId: string, userId: string): void {
		RevisionHealthService.watch({
			deploymentId,
			enqueueRollback: (input) => this.enqueueDeploy(input),
			serviceId,
			userId,
		});
	}

	/** Re-arms health watches for every deployment still mid-watch after a restart, same rollback wiring as `watchHealth`. */
	resumeHealthWatches(): Promise<void> {
		return RevisionHealthService.resume((input) => this.enqueueDeploy(input));
	}

	/**
	 * Queues a deploy (or rollback, when `rollbackOfDeploymentId` is set):
	 * creates the `DeploymentDTO` row, marks the service pending, and enqueues
	 * a `deploy` job. Concurrent enqueues for the same service coalesce onto
	 * one queued job (`dedupeKey`/`lockKey` scoped to `service:${svc.id}`); when
	 * that happens this deployment's own row is marked `stopped` as superseded
	 * and the coalesced job's deployment id is returned instead.
	 */
	async enqueueDeploy(input: EnqueueDeployInput): Promise<EnqueueDeployResult> {
		const { svc, userId } = input;
		const rollbackOf = input.rollbackOfDeploymentId ?? null;
		const dep = await DeploymentDTO.create({
			id: input.clientDeploymentId || undefined,
			rollbackOfDeploymentId: rollbackOf,
			serviceId: svc.id,
			status: "pending",
			userId,
		});
		await svc.update({ currentStatus: "pending" });

		const entry = await QueueService.enqueue({
			dedupeKey: `${rollbackOf ? "rollback" : "deploy"}:${svc.id}`,
			dependsOnJobId: input.dependsOnJobId ?? null,
			lockKey: `service:${svc.id}`,
			payload: {
				deploymentId: dep.id,
				serviceId: svc.id,
				trigger: input.trigger ?? "manual",
				userId,
			},
			serviceId: svc.id,
			title: `${rollbackOf ? "Roll back" : "Deploy"} ${svc.name}`,
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

	/**
	 * Enqueues a stack deploy: every linked service first, each one's job
	 * chained (`dependsOnJobId`) after the previous so they deploy in order,
	 * then the primary service last, depending on the final linked job.
	 *
	 * @returns The primary service's enqueue result; linked services' own
	 *   deployment/job ids aren't surfaced to the caller.
	 */
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

	/**
	 * Runs an entire deploy end to end: loads the deploy plan, resolves (pulls
	 * or builds) the image, starts the container/swarm service, records the
	 * result, and arms the post-deploy health watch. This is the job worker's
	 * actual `deploy` job handler, invoked with the deployment id `enqueueDeploy`
	 * already created (or reuses `clientDeploymentId`'s row if it already
	 * exists, so a job retry doesn't create a duplicate one). Appends
	 * phase-by-phase progress to the deployment's log throughout, and sends a
	 * success/failure notification (both an in-app `NotificationDTO` and any
	 * configured notification channel) before returning. Never throws: any
	 * error is caught and turned into a `{ success: false }` result via
	 * `#recordFailure`.
	 */
	async deployService(
		svc: ServiceDTO,
		userId: string,
		clientDeploymentId?: string | null,
		trigger: DeployTrigger = "manual",
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
			const plan = await this.#loadDeployPlan(
				svc,
				userId,
				await revisionSourceFor(dep),
			);

			await dep.appendLog(phaseLine("volumes"));
			const mounts = await ServiceVolumeDTO.listForService(svc.id);

			await dep.appendLog(phaseLine("image"));
			const resolved = await this.#resolveImage(ctx, plan);
			const { image, tag } = resolved;

			await svc.update({ currentStatus: "starting" });

			const stack = svc.stackId
				? await StackDTO.get(svc.stackId, userId)
				: null;

			await dep.appendLog(phaseLine("container"));
			const ids = await this.#startWorkload({
				dep,
				image,
				mounts,
				plan: plan.workload,
				stack,
				svc,
				tag,
			});

			await dep.appendLog(phaseLine("network"));
			await this.#recordSuccess(ctx, ids, resolved, stack);
			this.watchHealth(dep.id, svc.id, userId);

			NotificationDTO.notify({
				message:
					trigger === "cron"
						? `"${svc.name}" was auto-redeployed.`
						: `"${svc.name}" deployed successfully.`,
				serviceId: svc.id,
				type: trigger === "cron" ? "auto_redeploy" : "deploy_success",
				userId,
			});
			NotificationChannelService.notifyDeploy({ dep, ok: true, svc, trigger });

			return {
				containerId: ids.containerId,
				deploymentId: dep.id,
				success: true,
			};
		} catch (err) {
			return await this.#recordFailure({ dep, svc, userId }, err, trigger);
		}
	}
}

export const DeploymentService = new DeploymentServiceClass();
