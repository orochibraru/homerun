import { z } from "zod";
import { CronJobDTO } from "$lib/dto/cron-job-dto";
import type { JobDTO } from "$lib/dto/job-dto";
import { CronJobService } from "../../cron-job.service.ts";
import { cronJobPayload } from "../payloads.ts";
import type { WorkerJob } from "./types.ts";

const executionSchema = z.object({
	exitCode: z.number(),
	output: z.string(),
	timedOut: z.boolean(),
});

const specSchema = z.object({ runId: z.string() });

async function cronJobFor(entry: JobDTO): Promise<CronJobDTO> {
	const { cronJobId } = cronJobPayload.parse(entry.payload);
	const job = await CronJobDTO.get(cronJobId);
	if (!job) {
		throw new Error("The cron job was deleted before it ran.");
	}
	return job;
}

export const cronJobWorkerJob: WorkerJob | null = {
	async finalize(entry, result, error) {
		const job = await cronJobFor(entry);
		const { runId } = specSchema.parse(entry.decryptSpec());
		const outcome = await CronJobService.finishRun(
			job,
			runId,
			result ? executionSchema.parse(result) : null,
			error,
		);
		if (!outcome.success) {
			throw new Error(outcome.error ?? "The cron job failed.");
		}
		return { exitCode: outcome.exitCode };
	},
	async prepare(entry) {
		return CronJobService.prepareRun(await cronJobFor(entry));
	},
};
