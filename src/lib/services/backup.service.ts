import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BackupRunDTO } from "$lib/dto/backup-run-dto";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { DockerService } from "./docker.service.ts";

const logger = new Logger("Backup");
const execFileAsync = promisify(execFile);

const ARCHIVE_HELPER_IMAGE = "alpine";
const ARCHIVE_HELPER_TAG = "3";
const ARCHIVE_MOUNT_PATH = "/homerun-backup-source";

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
	 * Both volume kinds are supported : a bind mount's `source` is a real
	 * host directory, tar'd directly; a Docker-managed named volume isn't
	 * visible on the host filesystem the same way, so it's mounted read-only
	 * into a short-lived helper container that tars it to stdout instead
	 * (see DockerService.runOneOff).
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
			const archive = await this.archive(volume);

			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const prefix = volume.backupPrefix ? `${volume.backupPrefix}/` : "";
			const key = `${prefix}${volume.name}-${timestamp}.tar.gz`;

			await upload(volume, key, archive, destination);

			logger.info(
				`Backup uploaded: volume=${volume.id} key=${key} bytes=${archive.length}`,
			);
			return { key, sizeBytes: archive.length, success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(`Backup failed: volume=${volume.id}`, err);
			return { error: message, success: false };
		}
	}

	private archive(volume: StorageVolumeDTO): Promise<Buffer> {
		return volume.kind === "bind"
			? this.archiveHostPath(volume.source)
			: this.archiveNamedVolume(volume.source);
	}

	private async archiveHostPath(source: string): Promise<Buffer> {
		const { stdout } = await execFileAsync(
			"tar",
			["-czf", "-", "-C", source, "."],
			{ encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 },
		);
		return stdout;
	}

	private async archiveNamedVolume(name: string): Promise<Buffer> {
		const result = await DockerService.runOneOff({
			binds: [`${name}:${ARCHIVE_MOUNT_PATH}:ro`],
			cmd: ["tar", "-czf", "-", "-C", ARCHIVE_MOUNT_PATH, "."],
			image: ARCHIVE_HELPER_IMAGE,
			tag: ARCHIVE_HELPER_TAG,
		});
		if (result.exitCode !== 0) {
			const detail = result.stderr.toString("utf8").trim();
			throw new Error(
				`Couldn't read the named volume "${name}" (exit ${result.exitCode})${
					detail ? `: ${detail}` : "."
				}`,
			);
		}
		return result.stdout;
	}
}
