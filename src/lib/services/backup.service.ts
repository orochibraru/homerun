import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BackupRunDTO } from "$lib/dto/backup-run-dto";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Backup");
const execFileAsync = promisify(execFile);

export interface BackupResult {
	error?: string;
	key?: string;
	sizeBytes?: number;
	success: boolean;
}

export interface ResolvedS3Destination {
	accessKeyId: string;
	bucket: string;
	endpoint: string;
	region: string;
	secretAccessKey: string;
}

/**
 * Base class for backing up a storage volume to some destination. Owns the
 * generic tar-then-upload pipeline (validate config, resolve+decrypt the
 * named destination, tar the source directory, log/return the result) : a
 * concrete subclass only supplies the "put these bytes at this key"
 * transport, via `upload()`. S3BackupService is the only implementation
 * today; a future non-S3 destination would extend this the same way.
 */
export abstract class BackupService {
	/**
	 * Backs up one storage volume, delegating the "put these bytes at this
	 * key" transport to `upload` (the resolved+decrypted destination is
	 * passed through so the subclass never has to look it up itself).
	 *
	 * Bind-mount sources only for v1 : `source` is a real host directory, so
	 * it can be tar'd directly. A Docker-managed named volume's content isn't
	 * visible on the host filesystem the same way (would need a short-lived
	 * helper container to read it out), so `kind: "volume"` is rejected here
	 * rather than silently doing nothing; that's a documented follow-up, not
	 * an oversight.
	 */
	protected async runBackup(
		volume: StorageVolumeDTO,
		upload: (
			volume: StorageVolumeDTO,
			key: string,
			body: Uint8Array,
			destination: ResolvedS3Destination,
		) => Promise<void>,
	): Promise<BackupResult> {
		// One row per attempt (scheduled or manual), finalized below on every
		// return path : the run log the dedicated Backups page reads, see
		// BackupRunDTO. Recorded here rather than at each caller
		// (BackupScheduler, the storage/[volumeId] "Run now" action) so every
		// backup path gets a log entry for free, including validation
		// failures below, not just upload attempts.
		const run = await BackupRunDTO.create(volume.id);
		const result = await this.attemptBackup(volume, upload);
		await run.finish(
			result.success
				? { sizeBytes: result.sizeBytes, success: true }
				: { error: result.error, success: false },
		);
		return result;
	}

	private async attemptBackup(
		volume: StorageVolumeDTO,
		upload: (
			volume: StorageVolumeDTO,
			key: string,
			body: Uint8Array,
			destination: ResolvedS3Destination,
		) => Promise<void>,
	): Promise<BackupResult> {
		if (volume.kind !== "bind") {
			return {
				error: "Only bind-mount volumes can be backed up right now.",
				success: false,
			};
		}
		if (!volume.s3DestinationId) {
			return {
				error: "No S3 destination picked for this volume.",
				success: false,
			};
		}

		const destinationRow = await S3DestinationDTO.get(
			volume.s3DestinationId,
			volume.userId,
		);
		if (!destinationRow) {
			return {
				error: "The picked S3 destination no longer exists.",
				success: false,
			};
		}
		const destination: ResolvedS3Destination = {
			accessKeyId: destinationRow.accessKeyId,
			bucket: destinationRow.bucket,
			endpoint: destinationRow.endpoint,
			region: destinationRow.region,
			secretAccessKey: destinationRow.decryptSecretAccessKey(),
		};
		if (!destination.secretAccessKey) {
			return {
				error: "Couldn't decrypt the destination's stored secret key.",
				success: false,
			};
		}

		try {
			// Tar the source directory in memory (gzip'd) : fine at the scale a
			// single-PUT, no-multipart uploader supports anyway.
			const { stdout } = await execFileAsync(
				"tar",
				["-czf", "-", "-C", volume.source, "."],
				{ encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 },
			);

			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const prefix = volume.backupPrefix ? `${volume.backupPrefix}/` : "";
			const key = `${prefix}${volume.name}-${timestamp}.tar.gz`;

			await upload(volume, key, stdout, destination);

			logger.info(
				`Backup uploaded: volume=${volume.id} key=${key} bytes=${stdout.length}`,
			);
			return { key, sizeBytes: stdout.length, success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(`Backup failed: volume=${volume.id}`, err);
			return { error: message, success: false };
		}
	}
}
