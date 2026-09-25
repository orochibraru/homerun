import { BackupRunDTO } from "$lib/dto/backup-run-dto";
import type { JobDTO } from "$lib/dto/job-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { S3BackupService } from "../../s3-backup.service.ts";
import { backupJobPayload } from "../payloads.ts";
import type { WorkerJob } from "./types.ts";

const logger = new Logger("Backup");

/**
 * Loads the volume a backup or restore job targets.
 *
 * @throws When the volume was deleted after the job was queued.
 */
export async function jobVolume(
	volumeId: string,
	action: string,
): Promise<StorageVolumeDTO> {
	const volume = await StorageVolumeDTO.get(volumeId);
	if (!volume) {
		throw new Error(`The volume was deleted before its ${action} ran.`);
	}
	return volume;
}

/**
 * Records a Go-executed backup or restore's outcome on the `backup_run` row
 * its prepare step opened (the run id travels in the job's spec), returning
 * the job result.
 *
 * @throws The executor's error, after recording it on the run.
 */
export async function finishRun(
	job: JobDTO,
	result: Record<string, unknown> | null,
	error: string | null,
	fallback: string,
): Promise<{ key: string | null; sizeBytes: number | null }> {
	const runId = job.decryptSpec()?.runId;
	const run = typeof runId === "string" ? await BackupRunDTO.get(runId) : null;
	if (error || !result) {
		const message = error ?? fallback;
		await run?.finish({ error: message, success: false });
		logger.error(`${job.type} failed: job=${job.id} ${message}`);
		throw new Error(message);
	}
	const key = typeof result.key === "string" ? result.key : null;
	const sizeBytes =
		typeof result.sizeBytes === "number" ? result.sizeBytes : null;
	await run?.finish({
		key: key ?? undefined,
		sizeBytes: sizeBytes ?? undefined,
		success: true,
	});
	logger.info(`${job.type} done: job=${job.id} key=${key} bytes=${sizeBytes}`);
	return { key, sizeBytes };
}

/**
 * Opens a `backup_run` row, then builds the spec with it; a spec that can't
 * be built still closes the run as failed before the error propagates, so the
 * history shows every attempt.
 */
export async function withRun(
	run: BackupRunDTO,
	build: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
	try {
		return { ...(await build()), runId: run.toJSON().id };
	} catch (err) {
		await run.finish({
			error: err instanceof Error ? err.message : String(err),
			success: false,
		});
		throw err;
	}
}

export const backupWorkerJob: WorkerJob | null = {
	async finalize(job, result, error) {
		const { volumeId } = backupJobPayload.parse(job.payload);
		await (await StorageVolumeDTO.get(volumeId))?.update({
			backupLastRunAt: new Date(),
		});
		return await finishRun(job, result, error, "Backup failed.");
	},
	async prepare(job) {
		const { volumeId } = backupJobPayload.parse(job.payload);
		const volume = await jobVolume(volumeId, "backup");
		const run = await BackupRunDTO.create(volume.id, { jobId: job.id });
		try {
			return await withRun(run, () => S3BackupService.backupSpec(volume));
		} catch (err) {
			await volume.update({ backupLastRunAt: new Date() });
			throw err;
		}
	},
};
