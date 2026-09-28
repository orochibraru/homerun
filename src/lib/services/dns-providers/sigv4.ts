import { createHash, createHmac } from "node:crypto";

export interface SigV4Credentials {
	accessKeyId: string;
	region: string;
	secretAccessKey: string;
	service: string;
	sessionToken?: string;
}

/** HMAC-SHA256 of `data` under `key`. */
function hmac(key: Buffer | string, data: string): Buffer {
	return createHmac("sha256", key).update(data, "utf8").digest();
}

/** Lowercase hex SHA-256 of `data`. */
function sha256Hex(data: string): string {
	return createHash("sha256").update(data, "utf8").digest("hex");
}

/** RFC 3986 percent-encoding, the flavour SigV4's canonical query string wants. */
function encode(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/**
 * Signs one request with AWS Signature Version 4 and returns the headers to
 * send: `headers` plus `host`, `x-amz-date`, `x-amz-security-token` when the
 * credentials carry a session token, and `authorization`. Every returned
 * header except `authorization` is signed.
 */
export function signV4(
	credentials: SigV4Credentials,
	request: {
		body: string;
		headers?: Record<string, string>;
		method: string;
		url: string;
	},
	date: Date,
): Record<string, string> {
	const url = new URL(request.url);
	const stamp = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
	const day = stamp.slice(0, 8);
	const headers: Record<string, string> = {
		host: url.host,
		"x-amz-date": stamp,
		...(credentials.sessionToken
			? { "x-amz-security-token": credentials.sessionToken }
			: {}),
	};
	for (const [name, value] of Object.entries(request.headers ?? {})) {
		headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
	}
	const names = Object.keys(headers).sort();
	const signedHeaders = names.join(";");
	const query = [...url.searchParams]
		.map(([key, value]) => [encode(key), encode(value)])
		.sort(([a = "", b = ""], [c = "", d = ""]) =>
			a === c ? (b < d ? -1 : 1) : a < c ? -1 : 1,
		)
		.map(([key, value]) => `${key}=${value}`)
		.join("&");
	const canonical = [
		request.method,
		url.pathname || "/",
		query,
		names.map((name) => `${name}:${headers[name]}\n`).join(""),
		signedHeaders,
		sha256Hex(request.body),
	].join("\n");
	const scope = `${day}/${credentials.region}/${credentials.service}/aws4_request`;
	const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join(
		"\n",
	);
	const key = hmac(
		hmac(
			hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region),
			credentials.service,
		),
		"aws4_request",
	);
	const signature = hmac(key, toSign).toString("hex");
	return {
		...headers,
		authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
	};
}
