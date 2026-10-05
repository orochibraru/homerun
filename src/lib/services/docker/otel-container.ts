import { createHash } from "node:crypto";
import {
	OTEL_COLLECTOR_HOST,
	OTEL_GRPC_PORT,
	OTEL_HTTP_PORT,
} from "#lib/tracing/env.js";
import { OTLP_TRACES_PATH } from "#lib/tracing/otlp.js";
import { MIRROR_LABEL } from "./image-scan-refs.ts";

export const OTEL_CONTAINER_NAME = OTEL_COLLECTOR_HOST;
export const OTEL_IMAGE = "otel/opentelemetry-collector-contrib";
export const OTEL_IMAGE_TAG = "0.161.0";
export const OTEL_CONFIG_VOLUME = "homerun-otel-config";
export const OTEL_CONFIG_DIR = "/etc/homerun-otel";
export const OTEL_CONFIG_FILE = `${OTEL_CONFIG_DIR}/config.yaml`;

const CONFIG_ENV = "HOMERUN_OTEL_CONFIG";
const ENDPOINT_ENV = "HOMERUN_OTLP_ENDPOINT";
const TOKEN_ENV = "HOMERUN_OTLP_TOKEN";

/** How the collector container should currently be configured. */
export interface OtelDesiredState {
	/** The app's own origin as the collector reaches it on the shared network. */
	appOrigin: string;
	/** The bearer token the ingest expects. */
	token: string;
}

/**
 * The collector's config file: OTLP over gRPC and HTTP in, a memory limiter
 * and a batcher, and OTLP/JSON out to Homerun's own ingest. It holds no
 * secret and no address: both come from the container's environment, so the
 * file never changes and can sit in a volume written once.
 */
export function otelCollectorConfig(): string {
	return [
		"receivers:",
		"  otlp:",
		"    protocols:",
		"      grpc:",
		`        endpoint: 0.0.0.0:${OTEL_GRPC_PORT}`,
		"      http:",
		`        endpoint: 0.0.0.0:${OTEL_HTTP_PORT}`,
		"processors:",
		"  memory_limiter:",
		"    check_interval: 1s",
		"    limit_mib: 200",
		"    spike_limit_mib: 50",
		"  batch:",
		"    send_batch_size: 512",
		"    send_batch_max_size: 1024",
		"    timeout: 5s",
		"exporters:",
		"  otlp_http/homerun:",
		`    endpoint: \${env:${ENDPOINT_ENV}}`,
		"    encoding: json",
		"    headers:",
		`      Authorization: "Bearer \${env:${TOKEN_ENV}}"`,
		"service:",
		"  telemetry:",
		"    metrics:",
		"      level: none",
		"  pipelines:",
		"    traces:",
		"      receivers: [otlp]",
		"      processors: [memory_limiter, batch]",
		"      exporters: [otlp_http/homerun]",
		"",
	].join("\n");
}

/**
 * The OTLP base URL the collector exports to: the app's origin plus the
 * ingest path without its `/v1/traces` suffix, which the exporter appends.
 */
export function otelExportEndpoint(appOrigin: string): string {
	return `${appOrigin.replace(/\/+$/, "")}${OTLP_TRACES_PATH.replace(/\/v1\/traces$/, "")}`;
}

/**
 * The container's environment: where it exports to, the token it presents,
 * and a digest of the config file, so a container written with an older file
 * no longer matches and gets recreated with the new one.
 */
export function otelEnv(state: OtelDesiredState): string[] {
	const digest = createHash("sha256")
		.update(otelCollectorConfig())
		.digest("hex")
		.slice(0, 16);
	return [
		`${CONFIG_ENV}=${digest}`,
		`${ENDPOINT_ENV}=${otelExportEndpoint(state.appOrigin)}`,
		`${TOKEN_ENV}=${state.token}`,
	];
}

/** The container's labels: only its infra marker, it's never routed by Traefik. */
export function otelLabels(): Record<string, string> {
	return { [MIRROR_LABEL]: "otel-collector" };
}

/**
 * Whether a container already runs the pinned image with `state`'s endpoint
 * and token, so it can be left alone. Anything else Docker adds is ignored.
 */
export function otelMatches(
	image: string | undefined,
	env: string[],
	state: OtelDesiredState,
): boolean {
	return (
		image === `${OTEL_IMAGE}:${OTEL_IMAGE_TAG}` &&
		otelEnv(state).every((entry) => env.includes(entry))
	);
}
