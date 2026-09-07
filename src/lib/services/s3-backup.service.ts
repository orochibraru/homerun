import { execFile } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
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

/**
 * Minimal AWS Signature V4 client : just enough to PUT one object to an
 * S3-compatible endpoint (AWS S3, MinIO, R2, Backblaze B2, etc.). No SDK
 * dependency, deliberately: this app stays dependency-light (see also
 * CronService's hand-rolled matcher). Single-request PUT only : no
 * multipart upload, so there's a practical size ceiling (comfortably fine
 * for typical home-lab bind-mount backups, not for huge datasets).
 */
export interface BackupResult {
	error?: string;
	key?: string;
	sizeBytes?: number;
	success: boolean;
}

export interface S3Config {
	accessKeyId: string;
	bucket: string;
	// Full endpoint URL, e.g. "https://s3.us-east-1.amazonaws.com" or a
	// self-hosted MinIO URL. Path-style addressing is used (bucket in the
	// path, not the hostname) : works against both AWS and MinIO.
	endpoint: string;
	region: string;
	secretAccessKey: string;
}

const HEX_RE = /^[0-9a-f]{64}$/;

function hmac(key: Buffer | string, data: string): Buffer {
	return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
	return createHash("sha256").update(data).digest("hex");
}

function amzDate(date: Date): { amzDate: string; dateStamp: string } {
	const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
	return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(
	secretAccessKey: string,
	dateStamp: string,
	region: string,
): Buffer {
	const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
	const kRegion = hmac(kDate, region);
	const kService = hmac(kRegion, "s3");
	return hmac(kService, "aws4_request");
}

/** Uploads `body` to `key` under the configured bucket. Throws on any non-2xx response. */
async function putObject(
	config: S3Config,
	key: string,
	body: Uint8Array,
): Promise<void> {
	const url = new URL(config.endpoint);
	url.pathname = `/${config.bucket}/${key}`.replace(/\/+/g, "/");

	const { amzDate: amz, dateStamp } = amzDate(new Date());
	const payloadHash = sha256Hex(Buffer.from(body));

	const headers: Record<string, string> = {
		host: url.host,
		"x-amz-content-sha256": payloadHash,
		"x-amz-date": amz,
	};
	const signedHeaderNames = Object.keys(headers).sort();
	const canonicalHeaders = signedHeaderNames
		.map((h) => `${h}:${headers[h]}\n`)
		.join("");
	const signedHeaders = signedHeaderNames.join(";");

	const canonicalRequest = [
		"PUT",
		url.pathname,
		"",
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join("\n");

	const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		amz,
		credentialScope,
		sha256Hex(canonicalRequest),
	].join("\n");

	const signature = hmac(
		signingKey(config.secretAccessKey, dateStamp, config.region),
		stringToSign,
	).toString("hex");

	if (!HEX_RE.test(signature)) {
		// Unreachable in practice (hex digest is always 64 lowercase hex
		// chars) : guards against a future refactor silently breaking this.
		throw new Error("Failed to compute a valid signature.");
	}

	const authorization =
		`AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
		`SignedHeaders=${signedHeaders}, Signature=${signature}`;

	const res = await fetch(url, {
		body: Buffer.from(body),
		headers: {
			...headers,
			authorization,
		},
		method: "PUT",
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`S3 PUT failed: ${res.status} ${res.statusText} ${text}`);
	}
}

class S3BackupServiceClass {
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
	async backupVolume(volume: StorageVolumeDTO): Promise<BackupResult> {
		// One row per attempt (scheduled or manual), finalized below on every
		// return path : the run log the dedicated Backups page reads, see
		// BackupRunDTO. Recorded here rather than at each caller
		// (BackupScheduler, the storage/[volumeId] "Run now" action) so every
		// backup path gets a log entry for free, including validation
		// failures below, not just upload attempts.
		const run = await BackupRunDTO.create(volume.id);
		const result = await this.attemptBackup(volume);
		await run.finish(
			result.success
				? { sizeBytes: result.sizeBytes, success: true }
				: { error: result.error, success: false },
		);
		return result;
	}

	private async attemptBackup(volume: StorageVolumeDTO): Promise<BackupResult> {
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
		const destination: S3Config = {
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

			await putObject(destination, key, archive);

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

export const S3BackupService = new S3BackupServiceClass();
