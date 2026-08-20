import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { decryptSecret } from "./secrets.ts";

const logger = new Logger("Backup");
const execFileAsync = promisify(execFile);

export interface BackupResult {
	error?: string;
	key?: string;
	success: boolean;
}

/**
 * Base class for backing up a storage volume to some destination. Owns the
 * generic tar-then-upload pipeline (validate config, decrypt the stored
 * secret, tar the source directory, log/return the result) — a concrete
 * subclass only supplies the "put these bytes at this key" transport, via
 * `upload()`. S3BackupService is the only implementation today; a future
 * non-S3 destination would extend this the same way.
 */
export abstract class BackupService {
	/**
	 * Backs up one storage volume, delegating the "put these bytes at this
	 * key" transport to `upload` (the decrypted destination secret is
	 * passed through so the subclass never has to decrypt it itself).
	 *
	 * Bind-mount sources only for v1 — `source` is a real host directory, so
	 * it can be tar'd directly. A Docker-managed named volume's content isn't
	 * visible on the host filesystem the same way (would need a short-lived
	 * helper container to read it out), so `kind: "volume"` is rejected here
	 * rather than silently doing nothing; that's a documented follow-up, not
	 * an oversight.
	 */
	protected static async runBackup(
		volume: StorageVolumeDTO,
		upload: (
			volume: StorageVolumeDTO,
			key: string,
			body: Uint8Array,
			secretAccessKey: string,
		) => Promise<void>,
	): Promise<BackupResult> {
		if (volume.kind !== "bind") {
			return {
				error: "Only bind-mount volumes can be backed up right now.",
				success: false,
			};
		}
		if (
			!(
				volume.backupEndpoint &&
				volume.backupBucket &&
				volume.backupRegion &&
				volume.backupAccessKeyId &&
				volume.backupSecretAccessKeyEnc
			)
		) {
			return {
				error: "Backup destination isn't fully configured.",
				success: false,
			};
		}

		const secretAccessKey = decryptSecret(volume.backupSecretAccessKeyEnc);
		if (!secretAccessKey) {
			return {
				error: "Couldn't decrypt the stored secret key.",
				success: false,
			};
		}

		try {
			// Tar the source directory in memory (gzip'd) — fine at the scale a
			// single-PUT, no-multipart uploader supports anyway.
			const { stdout } = await execFileAsync(
				"tar",
				["-czf", "-", "-C", volume.source, "."],
				{ encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 },
			);

			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const prefix = volume.backupPrefix ? `${volume.backupPrefix}/` : "";
			const key = `${prefix}${volume.name}-${timestamp}.tar.gz`;

			await upload(volume, key, stdout, secretAccessKey);

			logger.info(
				`Backup uploaded: volume=${volume.id} key=${key} bytes=${stdout.length}`,
			);
			return { key, success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(`Backup failed: volume=${volume.id}`, err);
			return { error: message, success: false };
		}
	}
}
