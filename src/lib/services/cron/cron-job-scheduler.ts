import { CronJobDTO } from "$lib/dto/cron-job-dto";
import { enqueueCronJobRun } from "../cron-job-queue.ts";
import { BaseScheduler } from "./base-scheduler.ts";
import { cronMatches, sameMinute } from "./cron-expression.ts";

export class CronJobScheduler extends BaseScheduler {
	protected readonly label = "Cron job";

	private isDueNow(job: CronJobDTO, now: Date): boolean {
		if (!cronMatches(job.schedule, now)) {
			return false;
		}
		return !(job.lastRunAt && sameMinute(job.lastRunAt, now));
	}

	private async fire(job: CronJobDTO, now: Date): Promise<void> {
		this.logger.info(
			`Cron job triggered: job=${job.id} schedule="${job.schedule}"`,
		);
		await job.update({ lastRunAt: now });
		await enqueueCronJobRun(job);
	}

	protected async tick(): Promise<void> {
		const now = new Date();
		const due = (await CronJobDTO.listEnabled()).filter((job) =>
			this.isDueNow(job, now),
		);

		await Promise.all(due.map((job) => this.fire(job, now)));
	}
}
