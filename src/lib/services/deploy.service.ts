import { phaseLine } from "$lib/deploy-phases";
import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import {
	type GitCredential,
	hasEmbeddedCredentials,
	providerForGitUrl,
} from "$lib/git-clone-url";
import { DEPLOY_LOG_SCOPE, Logger } from "$lib/logger";
import { shouldSkipPull } from "$lib/pull-policy";
import { decryptSecret } from "$lib/services/secrets";
import { AgentClientService } from "./agent-client.service.ts";
import {
	type BuildServer,
	type CacheRegistryCredentials,
	type DeployPlan,
	type GitBuildPlan,
	type GitSource,
	type ImagePlan,
	resolveDeployPlan,
	unreachable,
	type WorkloadPlan,
} from "./deploy/plan.ts";
import { serviceHostname, syncDns } from "./dns.service.ts";
import type { RegistryAuth } from "./docker/containers.ts";
import { DockerService, type RemoteHostConnection } from "./docker.service.ts";
import { NotificationChannelService } from "./notification-channel.service.ts";
import { deployJobPayload } from "./queue/payloads.ts";
import { QueueService } from "./queue.service.ts";

const logger = new Logger(DEPLOY_LOG_SCOPE);

type ServiceMounts = Awaited<
	ReturnType<typeof ServiceVolumeDTO.listForService>
>;

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

/**
 * Fires the configured DNS/routing providers for every hostname this service
 * answers on, and writes each one's verdict into the deployment log. It used
 * to be fire-and-forget with the provider swallowing its own failures into a
 * `logger.warn`, which is how "Pangolin is configured and nothing ever gets
 * created" stayed invisible. Still never fails a deploy : the container is
 * already up and running by the time this runs.
 */
async function syncAutoDns(
	svc: ServiceDTO,
	stack: StackDTO | null,
	dep: DeploymentDTO,
): Promise<void> {
	if (!svc.dnsResolvable) {
		return;
	}
	const row = svc.toJSON();
	const hostnames = [
		serviceHostname(svc.slug, stack?.slug),
		...(row.customDomain ? [row.customDomain] : []),
	];
	const results = await syncDns(hostnames);
	if (results.length > 0) {
		await dep.appendLog(
			results
				.map(
					(result) =>
						`${result.ok ? "DNS" : "DNS failed"} (${result.provider}): ${result.detail}`,
				)
				.join("\n"),
		);
	}
	const failed = results.filter((result) => !result.ok);
	if (failed.length > 0) {
		logger.warn(
			`DNS sync incomplete: service=${svc.id} ${failed
				.map((result) => `${result.provider}=${result.detail}`)
				.join(" ")}`,
		);
	}
}

/** Volume mounts in the shape both the container and swarm create calls want. */
function toVolumeParams(mounts: ServiceMounts) {
	return mounts.map((m) => ({
		containerPath: m.mount.toJSON().containerPath,
		readOnly: m.mount.toJSON().readOnly,
		source: m.volumeSource,
	}));
}

function registryAuth(registry: CacheRegistryCredentials): RegistryAuth {
	return {
		password: registry.password,
		serveraddress: registry.registryUrl,
		username: registry.username,
	};
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
async function resolveGitCredential(
	gitUrl: string,
	userId: string,
): Promise<GitCredential | null> {
	if (hasEmbeddedCredentials(gitUrl)) {
		return null;
	}
	const settings = await InstanceSettingsDTO.get();
	const provider = providerForGitUrl(
		gitUrl,
		settings.gitProviders.filter((p) => p.enabled),
	);
	if (!provider) {
		return null;
	}
	const connection = await GitConnectionDTO.getForUserAndProvider(
		userId,
		provider.id,
	);
	if (!connection) {
		return null;
	}
	const token = decryptSecret(connection.accessTokenEnc);
	if (!token) {
		return null;
	}
	return {
		token,
		username: connection.toJSON().providerUsername || "oauth2",
	};
}

class DeploymentServiceClass {
	async #loadDeployPlan(svc: ServiceDTO, userId: string): Promise<DeployPlan> {
		const settings = await InstanceSettingsDTO.get();
		const isGitBuild = svc.buildSource === "git";

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
			service: svc.toJSON(),
		});
	}

	/** Clone + build on the local socket or a docker remote. */
	async #runDockerBuild(
		ctx: DeployContext,
		git: GitSource,
		target: {
			cacheRegistry: CacheRegistryCredentials | null;
			remote?: RemoteHostConnection;
		},
		ref: string,
	): Promise<void> {
		const { dep } = ctx;
		const result = await DockerService.buildFromGit(
			{
				buildContext: git.buildContext,
				cacheRegistry: target.cacheRegistry,
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
					{ cacheRegistry: plan.cacheRegistry },
					ref,
				);
				return { image, tag };
			case "docker-build": {
				const publishedImage = `${plan.registry.registryUrl}/${image}`;
				await this.#runDockerBuild(
					ctx,
					plan.git,
					{ cacheRegistry: plan.registry, remote: plan.server.connection },
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

	async #pullImage(
		ctx: DeployContext,
		plan: Extract<ImagePlan, { kind: "pull" }>,
	): Promise<ResolvedImage> {
		const { dep, svc } = ctx;
		const { image, pullPolicy, tag } = plan;
		const ref = `${image}:${tag}`;
		const local = await DockerService.localImageDigest(ref);
		const skip = shouldSkipPull(pullPolicy, local !== undefined);
		if (skip) {
			await dep.appendLog(skip);
			logger.info(
				`Image pull skipped (${pullPolicy}): ${ref} service=${svc.id}`,
			);
			if (local === undefined) {
				throw new Error(
					`Pull policy is "never" and ${ref} isn't on this host.`,
				);
			}
			return { digest: local, image, tag };
		}

		const { digest } = await DockerService.pullImage({
			auth: DockerService.buildAuthConfig(svc),
			image,
			onProgress: (line) => dep.appendLog(line),
			tag,
		});
		logger.info(
			`Image pulled: ${ref} digest=${digest ?? "unknown"} service=${svc.id}`,
		);
		return { digest, image, tag };
	}

	/**
	 * Resolves the image ref the deploy step should use : a git build
	 * (local, docker build server, or agent) or a pull here.
	 */
	async #resolveImage(
		ctx: DeployContext,
		plan: ImagePlan,
	): Promise<ResolvedImage> {
		switch (plan.kind) {
			case "pull":
				return await this.#pullImage(ctx, plan);
			case "local-build":
			case "docker-build":
			case "agent-build": {
				const built = await this.#buildGitImage(ctx, plan);
				// Persist the resolved tag immediately : createAndStartContainer,
				// and any future redeploy that reads svc.image/tag before this
				// deploy returns, must see the image that actually exists.
				await ctx.svc.update({ image: built.image, tag: built.tag });
				return { digest: "", ...built };
			}
			default:
				return unreachable(plan);
		}
	}
	/** Marks the service and deployment failed, notifies, and shapes the caller's DeployResult. */
	async #recordFailure(
		ctx: DeployContext,
		err: unknown,
		trigger: "manual" | "cron",
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
		NotificationChannelService.notifyDeploy({ dep, ok: false, svc, trigger });
		return { deploymentId: dep.id, error: errorMessage, success: false };
	}

	/** Post-start bookkeeping : persist the running state, close out the deployment row, sync DNS, notify. */
	async #recordSuccess(
		ctx: DeployContext,
		ids: { containerId?: string; swarmServiceId?: string },
		digest: string | null,
		stack: StackDTO | null,
	): Promise<void> {
		const { dep, svc } = ctx;
		const { containerId, swarmServiceId } = ids;

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
			containerId: containerId ?? swarmServiceId,
			finishedAt: new Date(),
			imageDigest: digest,
			status: "running",
		});
		await dep.appendLog(phaseLine("ready"));
		logger.info(
			`Deploy succeeded: service=${svc.id} container=${containerId ?? swarmServiceId} deployment=${dep.id}`,
		);

		await syncAutoDns(svc, stack, dep);
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
			const plan = await this.#loadDeployPlan(svc, userId);

			await dep.appendLog(phaseLine("volumes"));
			const mounts = await ServiceVolumeDTO.listForService(svc.id);

			await dep.appendLog(phaseLine("image"));
			const { digest, image, tag } = await this.#resolveImage(ctx, plan.image);

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
			await this.#recordSuccess(ctx, ids, digest, stack);

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
