import { z } from "zod";
import { CronJobDTO } from "#lib/dto/cron-job-dto.js";
import { CronJobRunDTO } from "#lib/dto/cron-job-run-dto.js";
import type { CronJobRun } from "#lib/server/db/schema.js";
import { requirePermission } from "#lib/server/remote-auth.js";
import { query } from "$app/server";

/**
 * A cron job's runs, re-read while one is still going : the container's
 * output is appended to the row as it arrives (see
 * `CronJobRunDTO.appendOutput`), so a long job shows its progress instead
 * of nothing until it exits.
 */
export const getCronJobRuns = query(
	z.string(),
	async (cronJobId): Promise<CronJobRun[]> => {
		requirePermission("cron-jobs", "read");
		const job = await CronJobDTO.get(cronJobId);
		if (!job) {
			return [];
		}
		const runs = await CronJobRunDTO.listForJob(job.id);
		return runs.map((run) => run.toJSON());
	},
);
