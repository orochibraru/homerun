import { BackupRunDTO } from "$lib/dto/backup-run-dto";
import { S3BackupService } from "../../s3-backup.service.ts";
import { backupRestoreJobPayload } from "../payloads.ts";
import { finishRun, jobVolume, withRun } from "./backup.ts";
import type { WorkerJob } from "./types.ts";

export const backupRestoreWorkerJob: WorkerJob | null = {
	async finalize(job, result, error) {
		const { key } = backupRestoreJobPayload.parse(job.payload);
		const { sizeBytes } = await finishRun(
			job,
			result,
			error,
			"Restore failed.",
		);
		return { key, sizeBytes };
	},
	async prepare(job) {
		const { key, stopServices, volumeId, wipe } = backupRestoreJobPayload.parse(
			job.payload,
		);
		const volume = await jobVolume(volumeId, "restore");
		const run = await BackupRunDTO.create(volume.id, {
			jobId: job.id,
			key,
			kind: "restore",
		});
		return await withRun(run, () =>
			S3BackupService.restoreSpec(volume, key, { stopServices, wipe }),
		);
	},
};
