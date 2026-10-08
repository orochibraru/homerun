import { createHash, createHmac } from "node:crypto";

export interface S3Credentials {
	accessKeyId: string;
	endpoint: string;
	region: string;
	secretAccessKey: string;
}

export interface S3Request {
	body?: string | Uint8Array<ArrayBuffer>;
	headers?: Record<string, string>;
	method: "DELETE" | "GET" | "HEAD" | "POST" | "PUT";
	path: string;
	query?: Record<string, string>;
}

export interface SignedS3Request {
	headers: Record<string, string>;
	url: URL;
}

function hmac(key: Buffer | string, data: string): Buffer {
	return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string | Uint8Array): string {
	const hash = createHash("sha256");
	return (
		typeof data === "string" ? hash.update(data, "utf8") : hash.update(data)
	).digest("hex");
}

/** RFC 3986 encoding, which is what SigV4's canonical request expects. */
function encodeRfc3986(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/** The path with every segment encoded once and runs of slashes collapsed. */
function canonicalPath(path: string): string {
	return `/${path
		.replace(/\/+/g, "/")
		.replace(/^\//, "")
		.split("/")
		.map(encodeRfc3986)
		.join("/")}`;
}

/** Query parameters sorted by name and encoded, as SigV4 canonicalises them. */
function canonicalQuery(query: Record<string, string>): string {
	return Object.entries(query)
		.map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([key, value]) => `${key}=${value}`)
		.join("&");
}

/**
 * Signs one path-style S3 request with AWS Signature Version 4: the URL to
 * call and every header to send, `authorization` included. Path-style
 * addressing (the bucket in the path) works against AWS, Garage, MinIO and
 * the other S3-compatible stores alike.
 */
export function signS3Request(
	credentials: S3Credentials,
	request: S3Request,
	now: Date = new Date(),
): SignedS3Request {
	const url = new URL(credentials.endpoint);
	url.pathname = canonicalPath(request.path);
	const query = canonicalQuery(request.query ?? {});
	url.search = query;

	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
	const dateStamp = amzDate.slice(0, 8);
	const payloadHash = sha256Hex(request.body ?? "");
	const headers: Record<string, string> = {
		...Object.fromEntries(
			Object.entries(request.headers ?? {}).map(([name, value]) => [
				name.toLowerCase(),
				value.trim(),
			]),
		),
		host: url.host,
		"x-amz-content-sha256": payloadHash,
		"x-amz-date": amzDate,
	};
	const names = Object.keys(headers).sort();
	const signedHeaders = names.join(";");
	const canonicalRequest = [
		request.method,
		url.pathname,
		query,
		names.map((name) => `${name}:${headers[name]}\n`).join(""),
		signedHeaders,
		payloadHash,
	].join("\n");
	const scope = `${dateStamp}/${credentials.region}/s3/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256Hex(canonicalRequest),
	].join("\n");
	const key = hmac(
		hmac(
			hmac(
				hmac(`AWS4${credentials.secretAccessKey}`, dateStamp),
				credentials.region,
			),
			"s3",
		),
		"aws4_request",
	);
	const signature = hmac(key, stringToSign).toString("hex");
	return {
		headers: {
			...headers,
			authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
		},
		url,
	};
}

/** Sends one signed S3 request and returns the raw response, whatever its status. */
export async function s3Fetch(
	credentials: S3Credentials,
	request: S3Request,
	fetcher: typeof fetch = fetch,
): Promise<Response> {
	const signed = signS3Request(credentials, request);
	return await fetcher(signed.url, {
		headers: signed.headers,
		method: request.method,
		...(request.body ? { body: request.body } : {}),
	});
}

/**
 * Throws when an S3 response isn't a success, with the store's own error
 * code and message when the body carries them.
 *
 * @throws Always, when `response.ok` is false.
 */
export async function expectS3Ok(
	response: Response,
	what: string,
): Promise<void> {
	if (response.ok) {
		return;
	}
	const text = await response.text().catch(() => "");
	const code = text.match(/<Code>([^<]*)<\/Code>/)?.[1];
	const message = text.match(/<Message>([^<]*)<\/Message>/)?.[1];
	const detail = code ? `${code}${message ? `: ${message}` : ""}` : text;
	throw new Error(
		`S3 ${what} failed: ${response.status} ${response.statusText} ${detail}`.trim(),
	);
}
