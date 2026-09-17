import type { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceGitDTO } from "$lib/dto/service-git-dto";
import { isCommitSha, pollOutcome } from "$lib/git-ref";
import { DeploymentService } from "../deploy.service.ts";
import { StatusCheckService } from "../status-check.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const TICK_MS = 2 * 60 * 1000;

/**
 * Deploy on push without a reachable dashboard: every two minutes, reads the
 * head of the branch of each git service that deploys on push but has no
 * registered webhook (or has polling turned on), through the provider's API
 * with the owner's connection, and enqueues a deploy when it moved.
 */
export class GitPollScheduler extends BaseScheduler {
	protected readonly label = "GitPoll";

	protected readonly intervalMs = TICK_MS;

	/** Polls every pollable service one after another, so a slow provider never runs two reads of the same repo at once. */
	protected async tick(): Promise<void> {
		const services = await ServiceGitDTO.listPushPollable();
		for (const svc of services) {
			if (isCommitSha(svc.gitRef) || !svc.gitUrl) {
				continue;
			}
			// biome-ignore lint/performance/noAwaitInLoops: sequential on purpose, provider APIs rate-limit per token
			await this.#poll(svc, svc.gitUrl).catch((err) => {
				this.logger.warn(
					`Couldn't read the branch head: service=${svc.id} : ${err instanceof Error ? err.message : String(err)}`,
				);
			});
		}
	}

	/**
	 * Reads one service's branch head and records it, enqueueing a deploy as
	 * the service's owner when it differs from the last head seen.
	 *
	 * @throws When the provider API can't be resolved or read.
	 */
	async #poll(svc: ServiceDTO, gitUrl: string): Promise<void> {
		const branch = svc.gitRef || "main";
		const client = await StatusCheckService.clientFor(gitUrl, svc.userId);
		const head = await client.resolveCommit(branch);
		const outcome = pollOutcome(svc.toJSON().gitLastSeenCommit, head);
		if (outcome === "unchanged") {
			return;
		}
		await svc.update({ gitLastSeenCommit: head });
		if (outcome === "baseline") {
			return;
		}
		const { deploymentId } = await DeploymentService.enqueueDeploy({
			svc,
			trigger: "push",
			userId: svc.userId,
		});
		this.logger.info(
			`${branch} moved to ${head.slice(0, 7)}, deploying service=${svc.id} deployment=${deploymentId}`,
		);
	}
}
