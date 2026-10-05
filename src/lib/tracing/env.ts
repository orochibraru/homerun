import { SERVICE_ID_ATTRIBUTE } from "./otlp.ts";

export const OTEL_COLLECTOR_HOST = "homerun-otel";

export const OTEL_GRPC_PORT = 4317;

export const OTEL_HTTP_PORT = 4318;

const RESOURCE_ATTRIBUTES = "OTEL_RESOURCE_ATTRIBUTES";

/**
 * A traced service's environment: its own variables plus the OpenTelemetry
 * SDK's standard ones pointing at Homerun's collector. A variable the service
 * sets itself always wins, except `OTEL_RESOURCE_ATTRIBUTES`, which gets
 * `homerun.service.id` added to whatever the service put there so its spans
 * still land on it under any service name.
 */
export function withTracingEnv(
	userEnv: Record<string, string>,
	service: { id: string; slug: string },
): Record<string, string> {
	const injected: Record<string, string> = {
		OTEL_EXPORTER_OTLP_ENDPOINT: `http://${OTEL_COLLECTOR_HOST}:${OTEL_HTTP_PORT}`,
		OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
		OTEL_SERVICE_NAME: service.slug,
		OTEL_TRACES_EXPORTER: "otlp",
	};
	const merged = { ...injected, ...userEnv };
	const own = `${SERVICE_ID_ATTRIBUTE}=${service.id}`;
	const existing = userEnv[RESOURCE_ATTRIBUTES]?.trim() ?? "";
	const named = existing
		.split(",")
		.some((pair) => pair.split("=")[0]?.trim() === SERVICE_ID_ATTRIBUTE);
	if (!named) {
		merged[RESOURCE_ATTRIBUTES] = existing ? `${own},${existing}` : own;
	}
	return merged;
}
