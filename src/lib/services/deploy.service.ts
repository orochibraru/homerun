import { config } from "$lib/config";
import { phaseLine } from "$lib/deploy-phases";
import type { DeployTrigger } from "$lib/deploy-trigger";
import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ImageScanDTO } from "$lib/dto/image-scan-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import type { JobDTO } from "$lib/dto/job-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { ServiceDependencyDTO } from "$lib/dto/service-dependency-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import type { TrivySummary } from "$lib/image-scan";
import { DEPLOY_LOG_SCOPE, Logger } from "$lib/logger";
import { snapshotRevisionConfig } from "$lib/revision-config";
import { dependencyLayers } from "$lib/service-graph";
import { isDeployed } from "$lib/service-state";
import { syncAutoDns } from "./deploy/helpers.ts";
import {
	type BuildServer,
	type CacheRegistryCredentials,
	type DeployPlan,
	type RevisionSource,
	resolveDeployPlan,
} from "./deploy/plan.ts";
import { restoreRevisionConfig } from "./deploy/revision-step.ts";
import {
	notifyStatusChecksFailed,
	StatusChecksFailedError,
} from "./deploy/status-check-step.ts";
import { deployWorkerSpec } from "./deploy/worker-spec.ts";
import { RolloutFailedError } from "./docker/rollout.ts";
import { DockerService } from "./docker.service.ts";
import { ImageScanBlockedError } from "./image-scan.service.ts";
import { NotificationChannelService } from "./notification-channel.service.ts";
import { imageScanMessage } from "./notification-messages.ts";
import type { JobResult } from "./queue/handlers.ts";
import { deployJobPayload } from "./queue/payloads.ts";
import { QueueService } from "./queue.service.ts";
import { RevisionHealthService } from "./revision-health.service.ts";

const logger = new Logger(DEPLOY_LOG_SCOPE);

interface DeployContext {
	dep: DeploymentDTO;
	svc: ServiceDTO;
	userId: string;
}

interface ResolvedImage {
	digest: string | null;
	image: string;
	imageId: string | null;
	tag: string;
}

export interface EnqueueDeployInput {
	clientDeploymentId?: string | null;
	dependsOnJobId?: string | null;
	noCache?: boolean;
	restoreConfig?: boolean;
	rollbackOfDeploymentId?: string | null;
	svc: ServiceDTO;
	trigger?: DeployTrigger;
	userId: string;
}

export interface EnqueueDeployResult {
	deploymentId: string;
	jobId: string;
}

interface WorkerScan {
	digest?: string;
	error?: string;
	imageRef: string;
	source: string;
	status: "ok" | "failed" | "skipped";
	summary?: TrivySummary;
}

interface WorkerDeployOutcome {
	built?: boolean;
	containerId?: string;
	digest?: string;
	failure?: "scan-blocked" | "rollout-failed";
	gitCommit?: string;
	gitRef?: string;
	image?: string;
	imageId?: string;
	scans?: WorkerScan[];
	serviceImage?: { image: string; tag: string };
	swarmServiceId?: string;
	tag?: string;
}

/** The error a worker-reported failure stands for, so `#recordFailure` keeps the previous workload's status for a scan block or a failed rollout. */
function workerFailure(
	kind: WorkerDeployOutcome["failure"],
	message: string,
): Error {
	switch (kind) {
		case "scan-blocked":
			return new ImageScanBlockedError(message);
		case "rollout-failed":
			return new RolloutFailedError(message);
		default:
			return new Error(message);
	}
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
		revision: RevisionSource | null,
	): Promise<DeployPlan> {
		const settings = await InstanceSettingsDTO.get();
		const isGitBuild = svc.buildSource === "git" && !revision;

		const cacheRegistryRow =
			isGitBuild && svc.buildCacheRegistryId
				? await BuildCacheRegistryDTO.get(svc.buildCacheRegistryId)
				: null;
		const cacheRegistry: CacheRegistryCredentials | null = cacheRegistryRow
			? {
					password: cacheRegistryRow.decryptPassword(),
					registryUrl: cacheRegistryRow.registryUrl,
					username: cacheRegistryRow.username,
				}
			: null;

		let buildServer: BuildServer | null = null;
		if (isGitBuild && svc.buildServerRemoteHostId) {
			const target = await RemoteHostDTO.resolveBuildTarget(
				svc.buildServerRemoteHostId,
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

	/** Marks the deployment failed (and the service too, unless a status-check block, an image-scan block or a failed health-gated rollout left its previous workload running), notifies, and returns the error message. */
	async #recordFailure(
		ctx: DeployContext,
		err: unknown,
		trigger: DeployTrigger,
	): Promise<string> {
		const { dep, svc } = ctx;
		const errorMessage = err instanceof Error ? err.message : String(err);
		const checksFailed = err instanceof StatusChecksFailedError;
		const keptRunning =
			checksFailed ||
			err instanceof ImageScanBlockedError ||
			err instanceof RolloutFailedError;
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
			await notifyStatusChecksFailed(svc, err);
			return errorMessage;
		}
		NotificationDTO.notify({
			message: `"${svc.name}" failed to deploy: ${errorMessage}`,
			serviceId: svc.id,
			type: "deploy_failure",
		});
		NotificationChannelService.notifyDeploy({ dep, ok: false, svc, trigger });
		return errorMessage;
	}

	/**
	 * Post-start bookkeeping once the container/swarm service is running :
	 * marks the service and deployment rows running, clears any dismissed
	 * error state on the service, clears the live health state of every
	 * revision this one supersedes, appends the closing log line, and syncs
	 * DNS for the service's hostname(s). Doesn't notify : the caller
	 * (`finalizeWorkerDeploy`) does that itself once this returns.
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
			imageId: resolved.imageId,
			imageRef: `${resolved.image}:${plainTag}`,
			status: "running",
		});
		await DeploymentDTO.clearSupersededHealth(svc.id, dep.id);
		await dep.appendLog(phaseLine("ready"));
		logger.info(
			`Deploy succeeded: service=${svc.id} container=${containerId ?? swarmServiceId} deployment=${dep.id}`,
		);

		await syncAutoDns(svc, stack, dep);
	}

	/** Sends the in-app and channel notifications for a deploy that reached "running". */
	#notifySuccess(dep: DeploymentDTO, svc: ServiceDTO, trigger: DeployTrigger) {
		NotificationDTO.notify({
			message:
				trigger === "cron"
					? `"${svc.name}" was auto-redeployed.`
					: `"${svc.name}" deployed successfully.`,
			serviceId: svc.id,
			type: trigger === "cron" ? "auto_redeploy" : "deploy_success",
		});
		NotificationChannelService.notifyDeploy({ dep, ok: true, svc, trigger });
	}

	/**
	 * The `deploy` job's prepare step, run in the app before the homerun worker
	 * executes it: marks the deployment and service pulling, resolves the
	 * configuration (a rollback's revision and its restored config, the config
	 * snapshot, the deploy plan, the volumes) and, for a git build, waits on its
	 * required status checks, then returns the worker's spec (see
	 * `deployWorkerSpec`). Writes the config, volumes and image phase lines.
	 *
	 * @throws When the service is gone, or anything before the hand-off fails,
	 *   after recording the failure on the deployment and service and notifying
	 *   the way a failed deploy always has.
	 */
	async prepareWorkerDeploy(job: JobDTO): Promise<Record<string, unknown>> {
		const { deploymentId, noCache, serviceId, trigger, userId } =
			deployJobPayload.parse(job.payload);
		const svc = await ServiceDTO.get(serviceId);
		if (!svc) {
			const message = "The service was deleted before its deploy ran.";
			await (await DeploymentDTO.get(deploymentId))?.update({
				errorMessage: message,
				finishedAt: new Date(),
				status: "failed",
			});
			throw new Error(message);
		}
		logger.info(
			`Deploy started: service=${svc.name} (${svc.id}) source=${svc.buildSource} ${
				svc.buildSource === "git"
					? `git=${svc.gitUrl}#${svc.gitRef ?? "main"}`
					: `image=${svc.image}:${svc.tag}`
			} user=${userId}`,
		);
		const dep =
			(await DeploymentDTO.get(deploymentId)) ??
			(await DeploymentDTO.create({
				id: deploymentId,
				serviceId: svc.id,
				status: "pulling",
				userId,
			}));
		await dep.update({ startedAt: new Date(), status: "pulling" });
		await svc.update({ currentStatus: "pulling" });

		const ctx: DeployContext = { dep, svc, userId };
		try {
			await dep.appendLog(phaseLine("config"));
			const revision = await revisionSourceFor(dep);
			if (revision && dep.restoreConfig) {
				await restoreRevisionConfig(ctx, revision.id);
			}
			await dep.update({
				configSnapshot: snapshotRevisionConfig(svc.toJSON()),
			});
			const plan = await this.#loadDeployPlan(svc, revision);
			await dep.appendLog(phaseLine("volumes"));
			const mounts = await ServiceVolumeDTO.listForService(svc.id);
			const stack = svc.stackId ? await StackDTO.get(svc.stackId) : null;
			await dep.appendLog(phaseLine("image"));
			return await deployWorkerSpec({ ...ctx, mounts, noCache, plan, stack });
		} catch (err) {
			throw new Error(await this.#recordFailure(ctx, err, trigger));
		}
	}

	/** Stores the scans the worker ran as scan history rows on the deployment, and alerts on critical findings the way an in-app scan does. */
	async #recordWorkerScans(
		dep: DeploymentDTO,
		svc: ServiceDTO,
		scans: WorkerScan[],
	): Promise<void> {
		for (const scan of scans) {
			const { summary } = scan;
			// oxlint-disable-next-line no-await-in-loop -- scan history keeps the order the worker ran them in
			await ImageScanDTO.create({
				counts: summary?.counts,
				deploymentId: dep.id,
				digest: scan.digest ?? null,
				error: scan.error ?? undefined,
				findings: summary?.findings,
				fixableCounts: summary?.fixableCounts,
				imageRef: scan.imageRef,
				serviceId: svc.id,
				source: scan.source,
				status: scan.status,
				totalFindings: summary?.totalFindings,
			});
			if (summary && summary.counts.critical > 0) {
				NotificationDTO.notify({
					message: `"${svc.name}" has ${summary.counts.critical} critical ${summary.counts.critical === 1 ? "vulnerability" : "vulnerabilities"} in ${scan.imageRef}.`,
					serviceId: svc.id,
					type: "image_scan_critical",
				});
				NotificationChannelService.notify(
					imageScanMessage(
						{
							counts: summary.counts,
							findings: summary.findings,
							imageRef: scan.imageRef,
							origin: config.auth.origin ?? null,
							service: { id: svc.id, name: svc.name },
						},
						new Date().toISOString(),
					),
				);
			}
		}
	}

	/** Records what the worker did whatever the outcome: the commit a git build built, the service's new image, and the scans. */
	async #applyWorkerOutcome(
		dep: DeploymentDTO,
		svc: ServiceDTO,
		outcome: WorkerDeployOutcome,
	): Promise<void> {
		if (outcome.built) {
			await dep.update({
				gitCommit: outcome.gitCommit || null,
				gitRef: outcome.gitRef || null,
			});
		}
		if (outcome.serviceImage) {
			await svc.update(outcome.serviceImage);
		}
		await this.#recordWorkerScans(dep, svc, outcome.scans ?? []);
	}

	/**
	 * The `deploy` job's finalize step, once the homerun worker has run it:
	 * records the built commit, the service's new image and the scans, then
	 * either the success (service and deployment running, superseded health
	 * cleared, DNS synced, health watch armed, notifications) or the failure
	 * (the service kept running when a scan block or a failed health-gated
	 * rollout left its previous workload in place).
	 *
	 * @returns The job result `POST /services/:id/deploy` answers with.
	 * @throws When the deploy failed, with its error message.
	 */
	async finalizeWorkerDeploy(
		job: JobDTO,
		result: Record<string, unknown> | null,
		error: string | null,
	): Promise<JobResult> {
		const { deploymentId, serviceId, trigger, userId } = deployJobPayload.parse(
			job.payload,
		);
		const [svc, dep] = await Promise.all([
			ServiceDTO.get(serviceId),
			DeploymentDTO.get(deploymentId),
		]);
		if (!(svc && dep)) {
			throw new Error("The service was deleted while it deployed.");
		}
		const outcome = (result ?? {}) as WorkerDeployOutcome;
		await this.#applyWorkerOutcome(dep, svc, outcome);

		const ctx: DeployContext = { dep, svc, userId };
		if (error !== null || !outcome.image) {
			const message = error ?? "The worker didn't report a deployed image.";
			throw new Error(
				await this.#recordFailure(
					ctx,
					workerFailure(outcome.failure, message),
					trigger,
				),
			);
		}

		const ids = {
			containerId: outcome.containerId || undefined,
			swarmServiceId: outcome.swarmServiceId || undefined,
		};
		const stack = svc.stackId ? await StackDTO.get(svc.stackId) : null;
		await this.#recordSuccess(
			ctx,
			ids,
			{
				digest: outcome.digest || null,
				image: outcome.image,
				imageId: outcome.imageId || null,
				tag: outcome.tag ?? "",
			},
			stack,
		);
		this.watchHealth(dep.id, svc.id, userId);
		this.#notifySuccess(dep, svc, trigger);
		return { containerId: ids.containerId ?? null, deploymentId: dep.id };
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
	 * Queues a redeploy when a service's login wall was turned on or off: the
	 * forwardAuth middleware is part of its routing labels, attached only while
	 * the wall is on, so the change only reaches Traefik with new labels. A
	 * service that was never deployed, or is stopped, picks it up on its next
	 * deploy instead.
	 *
	 * @returns Whether a redeploy was queued.
	 */
	async redeployIfLoginWallChanged(
		svc: ServiceDTO,
		wasRequired: boolean,
		userId: string,
	): Promise<boolean> {
		if (
			svc.authRequired === wasRequired ||
			!isDeployed(svc) ||
			svc.toJSON().desiredState === "stopped"
		) {
			return false;
		}
		await this.enqueueDeploy({ svc, trigger: "manual", userId });
		return true;
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
			restoreConfig: Boolean(rollbackOf && input.restoreConfig),
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
				noCache: input.noCache ?? false,
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
	 * Enqueues a stack deploy: every linked service first, dependencies
	 * (`ServiceDependencyDTO`) before the services that need them, each one's
	 * job chained (`dependsOnJobId`) after the previous so they deploy in
	 * order, then the primary service last, depending on the final linked job.
	 *
	 * @returns The primary service's enqueue result; linked services' own
	 *   deployment/job ids aren't surfaced to the caller.
	 */
	async enqueueStackDeploy(
		primary: ServiceDTO,
		linked: ServiceDTO[],
		userId: string,
	): Promise<EnqueueDeployResult> {
		const byId = new Map(linked.map((svc) => [svc.id, svc]));
		const ordered = dependencyLayers(
			linked.map((svc) => svc.id),
			await ServiceDependencyDTO.map(),
		)
			.reverse()
			.flat()
			.flatMap((id) => byId.get(id) ?? []);
		let dependsOnJobId: string | null = null;
		for (const svc of ordered) {
			// oxlint-disable-next-line no-await-in-loop -- each linked service's job id is the next one's dependency, so the chain is built in order
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
}

export const DeploymentService = new DeploymentServiceClass();
