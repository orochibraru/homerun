import type { CronJobDTO } from "$lib/dto/cron-job-dto";
import type { JobDTO } from "$lib/dto/job-dto";
import { QueueService } from "./queue.service.ts";

/** Enqueues a run of `job`, deduped and lock-scoped per cron job so it can't be queued (or run) more than once concurrently; `scheduled` marks one fired by the scheduler, whose outcome notification is grouped with the rest of that run. */
export function enqueueCronJobRun(
	job: CronJobDTO,
	scheduled = false,
): Promise<JobDTO> {
	return QueueService.enqueue({
		dedupeKey: `cron_job:${job.id}`,
		lockKey: `cron_job:${job.id}`,
		payload: { cronJobId: job.id, scheduled, userId: job.userId },
		title: `Run ${job.name}`,
		type: "cron_job",
		userId: job.userId,
	});
}
