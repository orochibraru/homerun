import { createHash, createHmac } from "node:crypto";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import {
	VOLUME_HELPER_IMAGE,
	VOLUME_HELPER_MOUNT_PATH,
	VOLUME_HELPER_TAG,
	VolumeServices,
} from "./backup/volume-services.ts";
import { MANAGED_LABEL } from "./docker/labels.ts";

export interface RestoreOptions {
	stopServices: boolean;
	wipe: boolean;
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

class S3BackupServiceClass {
	/**
	 * Everything the Go worker needs to back `volume` up: its decrypted
	 * destination, a fresh timestamped key, the pre-backup command's target
	 * and, with `backupStopServices`, the running services to stop around it.
	 *
	 * @throws When the destination can't be resolved or the pre-backup
	 *   command has nowhere to run.
	 */
	async backupSpec(volume: StorageVolumeDTO): Promise<Record<string, unknown>> {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const prefix = volume.backupPrefix ? `${volume.backupPrefix}/` : "";
		return {
			...this.#helperSpec(volume),
			destination: await this.destinationFor(volume),
			key: `${prefix}${volume.name}-${timestamp}.tar.gz`,
			preCommand: await VolumeServices.preCommandTarget(volume),
			stopServices: volume.backupStopServices
				? await VolumeServices.stopTargets(
						await VolumeServices.servicesUsing(volume),
					)
				: [],
		};
	}

	/**
	 * Everything the Go worker needs to restore backup `key` into `volume`,
	 * with the running services using it to stop when `options.stopServices`.
	 *
	 * @throws When the destination can't be resolved.
	 */
	async restoreSpec(
		volume: StorageVolumeDTO,
		key: string,
		options: RestoreOptions,
	): Promise<Record<string, unknown>> {
		return {
			...this.#helperSpec(volume),
			destination: await this.destinationFor(volume),
			key,
			stopServices: options.stopServices
				? await VolumeServices.stopTargets(
						await VolumeServices.servicesUsing(volume),
					)
				: [],
			wipe: options.wipe,
		};
	}

	/** The helper container the worker mounts the volume into, shared by backup and restore specs. */
	#helperSpec(volume: StorageVolumeDTO): Record<string, unknown> {
		return {
			helperImage: `${VOLUME_HELPER_IMAGE}:${VOLUME_HELPER_TAG}`,
			helperLabels: { [MANAGED_LABEL]: "true" },
			mountPath: VOLUME_HELPER_MOUNT_PATH,
			source: volume.source,
			volumeName: volume.name,
		};
	}

	/** The backups that exist for this volume, newest first : what the Restore picker lists. */
	async listBackups(volume: StorageVolumeDTO): Promise<BackupObject[]> {
		const destination = await this.destinationFor(volume);
		const prefix = volume.backupPrefix
			? `${volume.backupPrefix}/${volume.name}-`
			: `${volume.name}-`;
		return await listObjects(destination, prefix);
	}

	/**
	 * Resolves and decrypts a volume's S3 destination into an `S3Config`.
	 *
	 * @throws When the volume has no destination picked, the destination row
	 *   no longer exists, or its secret key can't be decrypted.
	 */
	async destinationFor(volume: StorageVolumeDTO): Promise<S3Config> {
		if (!volume.s3DestinationId) {
			throw new Error("No S3 destination picked for this volume.");
		}
		const row = await S3DestinationDTO.get(volume.s3DestinationId);
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
}

export const S3BackupService = new S3BackupServiceClass();
