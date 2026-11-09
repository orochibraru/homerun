import { RepositoryDTO } from "#lib/dto/repository-dto.js";

import { PipelineService } from "../pipeline.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const TICK_MS = 5 * 60 * 1000;

const WEBHOOK_POLL_MS = 60 * 60 * 1000;

/** Whether a repository's CI webhook keeps it current, so polling it can wait: registered, and synced within the hour. */
export function webhookKeepsCurrent(
	repo: { webhookId: string | null; pipelinesSyncedAt: Date | null },
	now: Date,
): boolean {
	return (
		!!repo.webhookId &&
		!!repo.pipelinesSyncedAt &&
		now.getTime() - repo.pipelinesSyncedAt.getTime() < WEBHOOK_POLL_MS
	);
}

/**
 * Every five minutes, syncs the CI runs of each watched repository with
 * syncing on, one after another; a failure is recorded on the repository
 * for its page and doesn't stop the others. A repository whose CI webhook
 * is registered is synced by its deliveries, so it's only polled once an
 * hour, in case one was lost. A sync asked for by hand or by a webhook goes
 * through the job queue instead (`PipelineService.enqueueSync`).
 */
export class PipelineSyncScheduler extends BaseScheduler {
	protected readonly label = "PipelineSync";

	protected readonly intervalMs = TICK_MS;

	protected readonly runOnStart = true;

	/** Syncs every repository with syncing on that its webhook doesn't keep current, sequentially so one token never runs two syncs at once. */
	protected async tick(): Promise<void> {
		const now = new Date();
		for (const repo of await RepositoryDTO.listPipelinesEnabled()) {
			if (webhookKeepsCurrent(repo.toJSON(), now)) {
				continue;
			}
			// oxlint-disable-next-line no-await-in-loop -- sequential on purpose, provider APIs rate-limit per token
			await PipelineService.sync(repo).catch((err) => {
				this.logger.warn(
					`Couldn't sync pipelines: repository=${repo.id} : ${err instanceof Error ? err.message : String(err)}`,
				);
			});
		}
	}
}
