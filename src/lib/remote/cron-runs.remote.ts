import { z } from "zod";
import { query } from "$app/server";
import { CronJobDTO } from "$lib/dto/cron-job-dto";
import { CronJobRunDTO } from "$lib/dto/cron-job-run-dto";
import type { CronJobRun } from "$lib/server/db/schema";
import { requireUser } from "$lib/server/remote-auth";

/**
 * A cron job's runs, re-read while one is still going : the container's
 * output is appended to the row as it arrives (see
 * `CronJobRunDTO.appendOutput`), so a long job shows its progress instead
 * of nothing until it exits.
 */
export const getCronJobRuns = query(
	z.string(),
	async (cronJobId): Promise<CronJobRun[]> => {
		requireUser();
		const job = await CronJobDTO.get(cronJobId);
		if (!job) {
			return [];
		}
		const runs = await CronJobRunDTO.listForJob(job.id);
		return runs.map((run) => run.toJSON());
	},
);
