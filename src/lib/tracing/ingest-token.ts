import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The bearer token the OpenTelemetry collector presents to the OTLP ingest:
 * an HMAC of a fixed label with the auth secret, like the worker's control
 * token, so nothing extra has to be stored or configured and a leaked token
 * doesn't hand over the secret itself.
 */
export function otlpIngestToken(secret: string): string {
	return createHmac("sha256", secret)
		.update("homerun-otlp-ingest")
		.digest("hex");
}

/** Whether an `Authorization` header carries the OTLP ingest token for `secret`, compared in constant time. */
export function validOtlpAuthorization(
	header: string | null,
	secret: string,
): boolean {
	const expected = Buffer.from(`Bearer ${otlpIngestToken(secret)}`);
	const actual = Buffer.from(header?.trim() ?? "");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
