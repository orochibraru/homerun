import { config } from "$lib/config";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import {
	HEALTH_WINDOW,
	type HealthVerdict,
	healthVerdict,
	previousRevision,
	type ReadinessSample,
	revisionRoot,
	type WorkloadHealthSample,
	withReadiness,
} from "$lib/revisions";
import type { Deployment } from "$lib/server/db/schema";
import { DockerService } from "./docker.service.ts";
import { NotificationChannelService } from "./notification-channel.service.ts";
import { revisionHealthMessage } from "./notification-messages.ts";
import { UptimeProbe } from "./uptime/uptime-probe.ts";

const logger = new Logger("RevisionHealth");

const POLL_MS = 5000;

const readinessProbe = new UptimeProbe();

const registry = globalThis as unknown as {
	__homerun_revision_watches?: Set<string>;
};

export type RollbackEnqueuer = (input: {
	rollbackOfDeploymentId: string;
	svc: ServiceDTO;
	userId: string;
}) => Promise<unknown>;

export interface RevisionWatch {
	deploymentId: string;
	enqueueRollback: RollbackEnqueuer;
	serviceId: string;
	startedAt?: Date;
	userId: string;
}

interface Workload {
	containerId: string | null;
	swarmServiceId: string | null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function watches(): Set<string> {
	registry.__homerun_revision_watches ??= new Set();
	return registry.__homerun_revision_watches;
}

function reason(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

class RevisionHealthServiceClass {
	/**
	 * Starts a background health watch for a deployment (deduplicated by
	 * deployment id, so re-watching an already-watched one is a no-op).
	 * Runs until it decides healthy/unhealthy or the workload stops being
	 * current; failures are logged, never thrown to the caller.
	 */
	watch(input: RevisionWatch): void {
		if (watches().has(input.deploymentId)) {
			return;
		}
		watches().add(input.deploymentId);
		this.#run(input)
			.catch((err) => {
				logger.warn(
					`Health watch failed: deployment=${input.deploymentId} : ${reason(err)}`,
				);
			})
			.finally(() => {
				watches().delete(input.deploymentId);
			});
	}

	/**
	 * Re-starts a `watch` for every deployment the DB still marks as being
	 * health-watched, called on boot since in-memory watches don't survive a
	 * restart. A failure listing them is logged and treated as no pending
	 * watches.
	 */
	async resume(enqueueRollback: RollbackEnqueuer): Promise<void> {
		const pending = await DeploymentDTO.listWatching().catch((err) => {
			logger.warn(`Couldn't resume health watches: ${reason(err)}`);
			return [];
		});
		for (const dep of pending) {
			const row = dep.toJSON();
			this.watch({
				deploymentId: row.id,
				enqueueRollback,
				serviceId: row.serviceId,
				startedAt: row.finishedAt ?? row.createdAt,
				userId: row.userId,
			});
		}
	}

	/** A point-in-time health sample for a workload: swarm task health since `since`, or the container's own health sample. */
	async #sample(
		workload: Workload,
		since: Date,
	): Promise<WorkloadHealthSample> {
		if (workload.swarmServiceId) {
			return await DockerService.swarmHealthSample(
				workload.swarmServiceId,
				since,
			);
		}
		return await DockerService.containerHealthSample(
			workload.containerId ?? "",
		);
	}

	/**
	 * The service's own HTTP answer on its container port, the uptime probe's
	 * internal check, or null when that check isn't HTTP (a database's TCP
	 * connect, or its own Docker healthcheck, which the health sample already
	 * covers) or couldn't run. Also null for a service with healthchecks
	 * turned off or nothing routed to it (not DNS resolvable, host
	 * networking), the same services the deploy's readiness gate skips: a
	 * background worker with no HTTP server isn't unready for not answering.
	 */
	async #readiness(svc: ServiceDTO): Promise<ReadinessSample | null> {
		if (
			svc.healthcheckDisabled ||
			!svc.dnsResolvable ||
			svc.networkMode === "host"
		) {
			return null;
		}
		const result = await readinessProbe.probeInternal(svc).catch(() => null);
		if (!result?.target?.startsWith("http://")) {
			return null;
		}
		return { detail: result.detail ?? "no answer", ok: result.ok };
	}

	/**
	 * Whether the watched deployment is still the service's latest deployment,
	 * running the same workload (container/swarm service), and not desired
	 * stopped. Returns the service when so, so the caller doesn't have to
	 * re-fetch it; null otherwise (the watch should stop).
	 */
	async #stillCurrent(
		input: RevisionWatch,
		workload: Workload,
	): Promise<ServiceDTO | null> {
		const svc = await ServiceDTO.get(input.serviceId);
		const [latest] = await DeploymentDTO.listForService(input.serviceId, 1);
		const sameWorkload =
			svc?.containerId === workload.containerId &&
			svc.swarmServiceId === workload.swarmServiceId;
		if (
			!svc ||
			latest?.id !== input.deploymentId ||
			!sameWorkload ||
			svc.toJSON().desiredState === "stopped"
		) {
			return null;
		}
		return svc;
	}

	/**
	 * The watch loop itself: polls the workload's health every `POLL_MS`
	 * against a baseline sample until `healthVerdict`, then `withReadiness`
	 * (the service has to answer its own HTTP port without a 5xx), return
	 * healthy or unhealthy (or the deployment stops being current, in which case its
	 * `health` is cleared and the watch just exits). Records the healthy
	 * outcome, or hands off to `#unhealthy` for the failure path. Every
	 * outcome is written through `settleHealth`, so a watch whose deployment
	 * a newer deploy already superseded (and cleared) records nothing.
	 */
	async #run(input: RevisionWatch): Promise<void> {
		const dep = await DeploymentDTO.get(input.deploymentId);
		const svc = await ServiceDTO.get(input.serviceId);
		if (!(dep && svc)) {
			return;
		}
		const startedAt = input.startedAt ?? new Date();
		const workload: Workload = {
			containerId: svc.containerId,
			swarmServiceId: svc.swarmServiceId,
		};
		const baseline = await this.#sample(workload, startedAt);
		let verdict: HealthVerdict = { verdict: "pending" };
		let current: ServiceDTO | null = svc;
		while (verdict.verdict === "pending") {
			// oxlint-disable-next-line no-await-in-loop -- the health window is sampled one tick at a time
			await sleep(POLL_MS);
			// oxlint-disable-next-line no-await-in-loop -- the health window is sampled one tick at a time
			current = await this.#stillCurrent(input, workload);
			if (!current) {
				// oxlint-disable-next-line no-await-in-loop -- the health window is sampled one tick at a time
				await dep.settleHealth(null);
				return;
			}
			// oxlint-disable-next-line no-await-in-loop -- the health window is sampled one tick at a time
			const sample = await this.#sample(workload, startedAt);
			const elapsedMs = Date.now() - startedAt.getTime();
			verdict = healthVerdict(baseline, sample, elapsedMs, HEALTH_WINDOW);
			if (verdict.verdict === "healthy") {
				verdict = withReadiness(
					verdict,
					// oxlint-disable-next-line no-await-in-loop -- the health window is sampled one tick at a time
					await this.#readiness(current),
					elapsedMs,
					HEALTH_WINDOW,
				);
			}
		}
		if (verdict.verdict === "healthy") {
			if (!(await dep.settleHealth("healthy"))) {
				return;
			}
			await dep.appendLog(
				`Revision healthy after ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s.`,
			);
			return;
		}
		await this.#unhealthy({ current, dep, input, reason: verdict.reason });
	}

	/**
	 * Decides the auto-rollback target for an unhealthy revision, or why none
	 * was chosen: auto-rollback is off, the revision was itself a rollback
	 * (never rolled back again), or there's no previous revision to fall
	 * back to. The target is the original deploy of that revision, never one
	 * of its redeploys, so the rollback folds into its row on the Revisions
	 * list.
	 */
	async #rollbackTarget(
		svc: ServiceDTO,
		dep: DeploymentDTO,
	): Promise<{ skipReason: string | null; target: Deployment | null }> {
		if (!svc.toJSON().autoRollback) {
			return {
				skipReason:
					"Auto-rollback is off for this service, so it was left running.",
				target: null,
			};
		}
		if (dep.rollbackOfDeploymentId) {
			return {
				skipReason:
					"This revision was itself a rollback, so it isn't rolled back again.",
				target: null,
			};
		}
		const revisions = (await DeploymentDTO.listRevisions(svc.id)).map((row) =>
			row.toJSON(),
		);
		const previous = previousRevision(revisions, dep.id);
		const target = previous ? revisionRoot(revisions, previous) : null;
		return {
			skipReason: target
				? null
				: "Auto-rollback is on, but there's no previous healthy revision to roll back to.",
			target,
		};
	}

	/**
	 * Handles a revision that failed its health check: resolves the
	 * auto-rollback target, marks the row `rolled_back` or `unhealthy` (and
	 * stops there, doing nothing else, when a newer deploy already superseded
	 * it), logs it, enqueues the rollback when eligible (else records why
	 * not), records an in-app notification, and dispatches it through
	 * notification channels.
	 */
	async #unhealthy(context: {
		current: ServiceDTO;
		dep: DeploymentDTO;
		input: RevisionWatch;
		reason: string;
	}): Promise<void> {
		const { current: svc, dep, input } = context;
		const { skipReason, target } = await this.#rollbackTarget(svc, dep);
		if (
			!(await dep.settleHealth(
				target ? "rolled_back" : "unhealthy",
				context.reason,
			))
		) {
			return;
		}
		await dep.appendLog(`Revision unhealthy: ${context.reason}`);
		logger.warn(
			`Revision unhealthy: service=${svc.id} deployment=${dep.id} : ${context.reason}`,
		);
		if (target) {
			await dep.appendLog(
				`Auto-rollback: redeploying revision ${target.id.slice(0, 8)} (${target.imageRef}).`,
			);
			await input.enqueueRollback({
				rollbackOfDeploymentId: target.id,
				svc,
				userId: input.userId,
			});
		} else if (skipReason) {
			await dep.appendLog(skipReason);
		}
		NotificationDTO.notify({
			message: target
				? `"${svc.name}" was rolled back to ${target.imageRef}: ${context.reason}`
				: `"${svc.name}"'s new revision is unhealthy: ${context.reason}`,
			serviceId: svc.id,
			type: target ? "deploy_rolled_back" : "deploy_unhealthy",
		});
		NotificationChannelService.notify(
			revisionHealthMessage(
				{
					origin: config.auth.origin ?? null,
					reason: context.reason,
					revision: dep.toJSON(),
					rolledBackTo: target,
					service: { id: svc.id, name: svc.name },
					skipReason,
				},
				new Date().toISOString(),
			),
		);
	}
}

export const RevisionHealthService = new RevisionHealthServiceClass();
