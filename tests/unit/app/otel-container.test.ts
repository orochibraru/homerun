import { describe, expect, mock, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const {
	OTEL_IMAGE,
	OTEL_IMAGE_TAG,
	otelCollectorConfig,
	otelEnv,
	otelExportEndpoint,
	otelLabels,
	otelMatches,
} = await import("../../../src/lib/services/docker/otel-container");

const state = { appOrigin: "http://homerun-auth:3000", token: "t0k3n" };
const image = `${OTEL_IMAGE}:${OTEL_IMAGE_TAG}`;

describe("otelCollectorConfig", () => {
	test("receives OTLP on both protocols and exports JSON to the ingest, with no secret in it", () => {
		const yaml = otelCollectorConfig();
		expect(yaml).toContain("endpoint: 0.0.0.0:4317");
		expect(yaml).toContain("endpoint: 0.0.0.0:4318");
		expect(yaml).toContain("otlp_http/homerun:");
		expect(yaml).toContain("encoding: json");
		expect(yaml).toContain("processors: [memory_limiter, batch]");
		expect(yaml).toContain("${env:HOMERUN_OTLP_ENDPOINT}");
		expect(yaml).toContain('Authorization: "Bearer ${env:HOMERUN_OTLP_TOKEN}"');
		expect(yaml).not.toContain("t0k3n");
	});
});

describe("otelExportEndpoint", () => {
	test("is the ingest path without the suffix the exporter appends", () => {
		expect(otelExportEndpoint("http://homerun-auth:3000")).toBe(
			"http://homerun-auth:3000/api/v1/otlp",
		);
		expect(otelExportEndpoint("http://host.docker.internal:5173/")).toBe(
			"http://host.docker.internal:5173/api/v1/otlp",
		);
	});
});

describe("otelEnv and otelMatches", () => {
	test("hand the address and token over as environment variables", () => {
		const [digest, ...rest] = otelEnv(state);
		expect(digest).toMatch(/^HOMERUN_OTEL_CONFIG=[0-9a-f]{16}$/);
		expect(rest).toEqual([
			"HOMERUN_OTLP_ENDPOINT=http://homerun-auth:3000/api/v1/otlp",
			"HOMERUN_OTLP_TOKEN=t0k3n",
		]);
		expect(otelLabels()).toEqual({ "homerun.infra": "otel-collector" });
	});

	test("leave a container on the same image, address and token alone", () => {
		const env = [...otelEnv(state), "PATH=/usr/bin"];
		expect(otelMatches(image, env, state)).toBe(true);
		expect(otelMatches(`${OTEL_IMAGE}:0.1.0`, env, state)).toBe(false);
		expect(otelMatches(image, env, { ...state, token: "rotated" })).toBe(false);
		expect(otelMatches(image, env.slice(1), state)).toBe(false);
		expect(
			otelMatches(image, env, { ...state, appOrigin: "http://homerun:3000" }),
		).toBe(false);
	});
});
