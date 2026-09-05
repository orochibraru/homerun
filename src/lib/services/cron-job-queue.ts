import type { CronJobDTO } from "$lib/dto/cron-job-dto";
import type { JobDTO } from "$lib/dto/job-dto";
import { QueueService } from "./queue.service.ts";

export function enqueueCronJobRun(job: CronJobDTO): Promise<JobDTO> {
	return QueueService.enqueue({
		dedupeKey: `cron_job:${job.id}`,
		lockKey: `cron_job:${job.id}`,
		payload: { cronJobId: job.id, userId: job.userId },
		title: `Run ${job.name}`,
		type: "cron_job",
		userId: job.userId,
	});
}
