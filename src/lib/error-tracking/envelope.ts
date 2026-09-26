import { gunzipSync, inflateSync } from "node:zlib";

export interface EnvelopeItem {
	payload: Uint8Array;
	type: string;
}

export interface Envelope {
	header: Record<string, unknown>;
	items: EnvelopeItem[];
}

export class EnvelopeError extends Error {}

const NEWLINE = 0x0a;
const decoder = new TextDecoder();

function parseJsonObject(
	bytes: Uint8Array,
	what: string,
): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(decoder.decode(bytes) || "{}");
	} catch {
		throw new EnvelopeError(`Invalid ${what} JSON`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new EnvelopeError(`The ${what} isn't a JSON object`);
	}
	return parsed as Record<string, unknown>;
}

function lineEnd(body: Uint8Array, from: number): number {
	const index = body.indexOf(NEWLINE, from);
	return index === -1 ? body.length : index;
}

/**
 * Parses a Sentry envelope: a JSON header line, then per item a JSON item
 * header line and its payload, read for `length` bytes when the header gives
 * one, else up to the next newline. The trailing newline is optional.
 *
 * @throws `EnvelopeError` for a malformed header or a payload shorter than its
 *   declared length.
 */
export function parseEnvelope(body: Uint8Array): Envelope {
	let offset = lineEnd(body, 0);
	const header = parseJsonObject(body.subarray(0, offset), "envelope header");
	offset += 1;
	const items: EnvelopeItem[] = [];
	while (offset < body.length) {
		const headerEnd = lineEnd(body, offset);
		const headerBytes = body.subarray(offset, headerEnd);
		offset = headerEnd + 1;
		if (headerBytes.length === 0) {
			continue;
		}
		const itemHeader = parseJsonObject(headerBytes, "item header");
		const length = itemHeader.length;
		let payload: Uint8Array;
		if (typeof length === "number" && length >= 0) {
			if (offset + length > body.length) {
				throw new EnvelopeError("An item is shorter than its declared length");
			}
			payload = body.subarray(offset, offset + length);
			offset += length + 1;
		} else {
			const payloadEnd = lineEnd(body, offset);
			payload = body.subarray(offset, payloadEnd);
			offset = payloadEnd + 1;
		}
		items.push({
			payload,
			type: typeof itemHeader.type === "string" ? itemHeader.type : "",
		});
	}
	return { header, items };
}

/**
 * Decompresses a request body sent with `Content-Encoding: gzip` or
 * `deflate` (zlib-wrapped or raw). Anything else is returned as is.
 *
 * @throws `EnvelopeError` when the body doesn't decompress, or inflates past
 *   `maxBytes`.
 */
export function decodeBody(
	body: Uint8Array,
	encoding: string | null,
	maxBytes: number,
): Uint8Array {
	const kind = encoding?.trim().toLowerCase();
	if (!kind || kind === "identity") {
		return body;
	}
	try {
		if (kind === "gzip" || kind === "x-gzip") {
			return gunzipSync(body, { maxOutputLength: maxBytes });
		}
		if (kind === "deflate") {
			return inflateSync(body, { maxOutputLength: maxBytes });
		}
	} catch {
		throw new EnvelopeError(`Couldn't decode the ${kind} body`);
	}
	throw new EnvelopeError(`Unsupported content encoding ${kind}`);
}

/** Parses a JSON item payload into an object, or null when it isn't one. */
export function jsonPayload(payload: Uint8Array): unknown {
	try {
		return JSON.parse(decoder.decode(payload));
	} catch {
		return null;
	}
}

const AUTH_PAIR_RE = /(\w+)\s*=\s*([^,\s]+)/g;

/**
 * The public key a request authenticates with: `sentry_key` from the
 * `X-Sentry-Auth` header (or an `Authorization: Sentry ...` one), else the
 * `sentry_key` query parameter, else the key in a `dsn` the envelope header
 * carries. Null when none is present.
 */
export function sentryKeyOf(input: {
	authHeader: string | null;
	envelopeDsn?: unknown;
	url: URL;
}): string | null {
	const header = input.authHeader?.trim();
	if (header?.toLowerCase().startsWith("sentry ")) {
		for (const match of header.slice(7).matchAll(AUTH_PAIR_RE)) {
			if (match[1] === "sentry_key") {
				return match[2];
			}
		}
	}
	const query = input.url.searchParams.get("sentry_key");
	if (query) {
		return query;
	}
	if (typeof input.envelopeDsn === "string") {
		try {
			return new URL(input.envelopeDsn).username || null;
		} catch {
			return null;
		}
	}
	return null;
}

const INGEST_PATH_RE = /\/api\/\d+\/(envelope|store)\/?$/;

/** Whether a request path is a Sentry ingest endpoint, which bypasses the dashboard's session, CSRF and access gates. */
export function isIngestPath(pathname: string): boolean {
	return INGEST_PATH_RE.test(pathname);
}
