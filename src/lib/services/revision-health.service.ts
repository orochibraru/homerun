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
	type WorkloadHealthSample,
} from "$lib/revisions";
import type { Deployment } from "$lib/server/db/schema";
import { DockerService } from "./docker.service.ts";
import { NotificationChannelService } from "./notification-channel.service.ts";
import { revisionHealthMessage } from "./notification-messages.ts";

const logger = new Logger("RevisionHealth");

const POLL_MS = 5000;

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

	async #stillCurrent(
		input: RevisionWatch,
		workload: Workload,
	): Promise<ServiceDTO | null> {
		const svc = await ServiceDTO.get(input.serviceId, input.userId);
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

	async #run(input: RevisionWatch): Promise<void> {
		const dep = await DeploymentDTO.get(input.deploymentId);
		const svc = await ServiceDTO.get(input.serviceId, input.userId);
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
			// biome-ignore lint/performance/noAwaitInLoops: the health window is sampled one tick at a time
			await sleep(POLL_MS);
			current = await this.#stillCurrent(input, workload);
			if (!current) {
				await dep.update({ health: null });
				return;
			}
			const sample = await this.#sample(workload, startedAt);
			verdict = healthVerdict(
				baseline,
				sample,
				Date.now() - startedAt.getTime(),
				HEALTH_WINDOW,
			);
		}
		if (verdict.verdict === "healthy") {
			await dep.update({ health: "healthy" });
			await dep.appendLog(
				`Revision healthy after ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s.`,
			);
			return;
		}
		await this.#unhealthy({ current, dep, input, reason: verdict.reason });
	}

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
		const target = previousRevision(revisions, dep.id);
		return {
			skipReason: target
				? null
				: "Auto-rollback is on, but there's no previous healthy revision to roll back to.",
			target,
		};
	}

	async #unhealthy(context: {
		current: ServiceDTO;
		dep: DeploymentDTO;
		input: RevisionWatch;
		reason: string;
	}): Promise<void> {
		const { current: svc, dep, input } = context;
		await dep.appendLog(`Revision unhealthy: ${context.reason}`);
		logger.warn(
			`Revision unhealthy: service=${svc.id} deployment=${dep.id} : ${context.reason}`,
		);
		const { skipReason, target } = await this.#rollbackTarget(svc, dep);
		if (target) {
			await dep.update({ health: "rolled_back" });
			await dep.appendLog(
				`Auto-rollback: redeploying revision ${target.id.slice(0, 8)} (${target.imageRef}).`,
			);
			await input.enqueueRollback({
				rollbackOfDeploymentId: target.id,
				svc,
				userId: input.userId,
			});
		} else {
			await dep.update({ health: "unhealthy" });
			if (skipReason) {
				await dep.appendLog(skipReason);
			}
		}
		NotificationDTO.notify({
			message: target
				? `"${svc.name}" was rolled back to ${target.imageRef}: ${context.reason}`
				: `"${svc.name}"'s new revision is unhealthy: ${context.reason}`,
			serviceId: svc.id,
			type: target ? "deploy_rolled_back" : "deploy_unhealthy",
			userId: input.userId,
		});
		NotificationChannelService.notify(
			input.userId,
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
