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

/**
 * Minimal AWS Signature V4 PUT : just enough to upload one object to an
 * S3-compatible endpoint (AWS S3, MinIO, R2, Backblaze B2, etc.). No SDK
 * dependency, deliberately: this app stays dependency-light (see also
 * CronService's hand-rolled matcher). Single-request PUT only : no
 * multipart upload, so there's a practical size ceiling (comfortably fine
 * for typical home-lab bind-mount backups, not for huge datasets).
 *
 * @throws On any non-2xx response.
 */
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

/** One signed S3 request : the same SigV4 dance `putObject` does, for the verbs restore needs. */
async function signedRequest(
	config: S3Config,
	method: "GET",
	path: string,
	queryString = "",
): Promise<Response> {
	const url = new URL(config.endpoint);
	url.pathname = path.replace(/\/+/g, "/");
	url.search = queryString;

	const { amzDate: amz, dateStamp } = amzDate(new Date());
	const payloadHash = sha256Hex("");

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
		method,
		url.pathname,
		queryString,
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

	return await fetch(url, {
		headers: {
			...headers,
			authorization:
				`AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
				`SignedHeaders=${signedHeaders}, Signature=${signature}`,
		},
		method,
	});
}

export interface BackupObject {
	key: string;
	lastModified: string | null;
	sizeBytes: number;
}

const CONTENTS_RE = /<Contents>([\s\S]*?)<\/Contents>/g;

function tagValue(xml: string, tag: string): string | null {
	const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
	return match?.[1] ?? null;
}

/** ListObjectsV2, parsed out of the XML response : no SDK, same posture as putObject. */
async function listObjects(
	config: S3Config,
	prefix: string,
): Promise<BackupObject[]> {
	const query = new URLSearchParams({
		"list-type": "2",
		"max-keys": "200",
		prefix,
	});
	query.sort();
	const res = await signedRequest(
		config,
		"GET",
		`/${config.bucket}`,
		query.toString(),
	);
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`S3 LIST failed: ${res.status} ${res.statusText} ${text}`);
	}
	const xml = await res.text();
	const objects: BackupObject[] = [];
	CONTENTS_RE.lastIndex = 0;
	let match: RegExpExecArray | null = CONTENTS_RE.exec(xml);
	while (match) {
		const body = match[1];
		const key = tagValue(body, "Key");
		if (key?.endsWith(".tar.gz")) {
			objects.push({
				key,
				lastModified: tagValue(body, "LastModified"),
				sizeBytes: Number.parseInt(tagValue(body, "Size") ?? "0", 10),
			});
		}
		match = CONTENTS_RE.exec(xml);
	}
	return objects.sort((a, b) => b.key.localeCompare(a.key));
}

async function getObject(config: S3Config, key: string): Promise<Buffer> {
	const res = await signedRequest(config, "GET", `/${config.bucket}/${key}`);
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`S3 GET failed: ${res.status} ${res.statusText} ${text}`);
	}
	return Buffer.from(await res.arrayBuffer());
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

	/**
	 * Validates the volume's S3 destination, archives it (`archive`), and
	 * uploads the archive under a timestamped key. Never throws: every
	 * failure (missing/deleted destination, undecryptable secret, archive or
	 * upload error) comes back as `{ success: false, error }`.
	 */
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

	/** The backups that exist for this volume, newest first : what the Restore picker lists. */
	async listBackups(volume: StorageVolumeDTO): Promise<BackupObject[]> {
		const destination = await this.#destinationFor(volume);
		const prefix = volume.backupPrefix
			? `${volume.backupPrefix}/${volume.name}-`
			: `${volume.name}-`;
		return await listObjects(destination, prefix);
	}

	/**
	 * Downloads one backup and unpacks it back over the volume's contents.
	 * Files in the archive replace the ones on disk; anything else already
	 * there is left alone, so this is a restore-over, not a wipe-and-restore.
	 */
	async restoreVolume(
		volume: StorageVolumeDTO,
		key: string,
	): Promise<BackupResult> {
		try {
			const destination = await this.#destinationFor(volume);
			const archive = await getObject(destination, key);
			await this.#restoreInto(volume.source, archive);
			logger.info(
				`Backup restored: volume=${volume.id} key=${key} bytes=${archive.length}`,
			);
			return { key, sizeBytes: archive.length, success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(`Restore failed: volume=${volume.id} key=${key}`, err);
			return { error: message, success: false };
		}
	}

	/**
	 * Resolves and decrypts a volume's S3 destination into an `S3Config`.
	 *
	 * @throws When the volume has no destination picked, the destination row
	 *   no longer exists, or its secret key can't be decrypted.
	 */
	async #destinationFor(volume: StorageVolumeDTO): Promise<S3Config> {
		if (!volume.s3DestinationId) {
			throw new Error("No S3 destination picked for this volume.");
		}
		const row = await S3DestinationDTO.get(
			volume.s3DestinationId,
			volume.userId,
		);
		if (!row) {
			throw new Error("The picked S3 destination no longer exists.");
		}
		const secretAccessKey = row.decryptSecretAccessKey();
		if (!secretAccessKey) {
			throw new Error("Couldn't decrypt the destination's stored secret key.");
		}
		return {
			accessKeyId: row.accessKeyId,
			bucket: row.bucket,
			endpoint: row.endpoint,
			region: row.region,
			secretAccessKey,
		};
	}

	/**
	 * Docker's own archive endpoint unpacks a (optionally compressed) tar
	 * straight into a container's filesystem, so a stopped helper with the
	 * target mounted is enough : no stdin plumbing into a running container,
	 * no `tar` needed on this host, and one path for both volume kinds since
	 * a bind's source is just as mountable as a named volume.
	 */
	async #restoreInto(source: string, archive: Buffer): Promise<void> {
		await DockerService.extractIntoVolume({
			archive,
			image: ARCHIVE_HELPER_IMAGE,
			mountPath: ARCHIVE_MOUNT_PATH,
			tag: ARCHIVE_HELPER_TAG,
			volumeName: source,
		});
	}

	/** Tars up a volume's contents: a host path directly, or a named volume through a helper container. */
	private archive(volume: StorageVolumeDTO): Promise<Buffer> {
		return volume.kind === "bind"
			? this.archiveHostPath(volume.source)
			: this.archiveNamedVolume(volume.source);
	}

	/** Runs `tar` on the host directly against a bind mount's real filesystem path. */
	private async archiveHostPath(source: string): Promise<Buffer> {
		const { stdout } = await execFileAsync(
			"tar",
			["-czf", "-", "-C", source, "."],
			{ encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 },
		);
		return stdout;
	}

	/**
	 * Tars a Docker-managed named volume by mounting it read-only into a
	 * short-lived Alpine helper container and running `tar` there, since a
	 * named volume isn't directly visible on the host filesystem.
	 *
	 * @throws When the helper container exits non-zero.
	 */
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
