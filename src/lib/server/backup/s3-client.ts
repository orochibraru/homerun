import { createHash, createHmac } from "node:crypto";

/**
 * Minimal AWS Signature V4 client — just enough to PUT one object to an
 * S3-compatible endpoint (AWS S3, MinIO, R2, Backblaze B2, etc.). No SDK
 * dependency, deliberately: this app stays dependency-light (see also
 * $lib/server/cron.ts's hand-rolled matcher). Single-request PUT only —
 * no multipart upload, so there's a practical size ceiling (comfortably
 * fine for typical home-lab bind-mount backups, not for huge datasets).
 */

export interface S3Config {
	accessKeyId: string;
	bucket: string;
	// Full endpoint URL, e.g. "https://s3.us-east-1.amazonaws.com" or a
	// self-hosted MinIO URL. Path-style addressing is used (bucket in the
	// path, not the hostname) — works against both AWS and MinIO.
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
export async function putObject(
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
		// chars) — guards against a future refactor silently breaking this.
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
