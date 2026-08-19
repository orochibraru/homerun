import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { decryptSecret } from "$lib/server/docker/secrets";
import { putObject } from "./s3-client";

const logger = new Logger("Backup");
const execFileAsync = promisify(execFile);

export interface BackupResult {
  error?: string;
  key?: string;
  success: boolean;
}

/**
 * Backs up one storage volume to its configured S3-compatible destination.
 *
 * Bind-mount sources only for v1 — `source` is a real host directory, so
 * it can be tar'd directly. A Docker-managed named volume's content isn't
 * visible on the host filesystem the same way (would need a short-lived
 * helper container to read it out), so `kind: "volume"` is rejected here
 * rather than silently doing nothing; that's a documented follow-up, not
 * an oversight.
 */
export async function backupVolume(
  volume: StorageVolumeDTO
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
    return { error: "Couldn't decrypt the stored secret key.", success: false };
  }

  try {
    // Tar the source directory in memory (gzip'd) — fine at the scale a
    // single-PUT, no-multipart uploader supports anyway (see s3-client.ts).
    const { stdout } = await execFileAsync(
      "tar",
      ["-czf", "-", "-C", volume.source, "."],
      { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 }
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const prefix = volume.backupPrefix ? `${volume.backupPrefix}/` : "";
    const key = `${prefix}${volume.name}-${timestamp}.tar.gz`;

    await putObject(
      {
        accessKeyId: volume.backupAccessKeyId,
        bucket: volume.backupBucket,
        endpoint: volume.backupEndpoint,
        region: volume.backupRegion,
        secretAccessKey,
      },
      key,
      stdout
    );

    logger.info(
      `Backup uploaded: volume=${volume.id} key=${key} bytes=${stdout.length}`
    );
    return { key, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Backup failed: volume=${volume.id}`, err);
    return { error: message, success: false };
  }
}
