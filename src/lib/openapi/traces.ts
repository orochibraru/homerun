import { z } from "zod";

import { appLogResponse } from "./operations";
import type { ParamDef, RouteDef } from "./registry";
import { errorResponse } from "./schemas";

const timestamp = z.string().meta({ description: "ISO 8601 timestamp" });
const unauthorized = { description: "Unauthorized", schema: errorResponse };
const serviceIdParam = { description: "Service id", name: "serviceId" };
const traceIdParam = {
	description: "The trace id, 32 hex digits",
	name: "traceId",
};

export const traceSummaryResponse = z.object({
	durationMs: z.number().meta({
		description: "From the first span's start to the last span's end",
	}),
	errorCount: z.number().int().meta({ description: "Spans that failed" }),
	rootName: z.string().meta({
		description: "The parentless span's name, else the earliest span's",
	}),
	serviceName: z.string().meta({ description: "The root span's service.name" }),
	spanCount: z.number().int(),
	startTime: timestamp,
	traceId: z.string(),
});

export const traceResponse = z.object({
	spans: z
		.array(
			z.object({
				attributes: z.record(z.string(), z.unknown()),
				durationMs: z.number(),
				endTime: timestamp,
				events: z
					.array(
						z.object({
							attributes: z.record(z.string(), z.unknown()),
							name: z.string(),
							time: z.string(),
						}),
					)
					.meta({
						description:
							"What happened during the span; a Homerun job's log lines land here",
					}),
				kind: z.number().int().meta({
					description:
						"OpenTelemetry span kind: 0 unspecified, 1 internal, 2 server, 3 client, 4 producer, 5 consumer",
				}),
				name: z.string(),
				parentSpanId: z.string().nullable(),
				resourceAttributes: z.record(z.string(), z.unknown()),
				serviceId: z.string().nullable().meta({
					description: "The Homerun service, null for Homerun's own spans",
				}),
				serviceName: z.string(),
				spanId: z.string(),
				startTime: timestamp,
				statusCode: z.number().int().meta({
					description: "0 unset, 1 ok, 2 error",
				}),
				statusMessage: z.string().nullable(),
				traceId: z.string(),
			}),
		)
		.meta({
			description:
				"Every span of the trace, from every service that took part, in start order (the first 5000)",
		}),
	traceId: z.string(),
});

const listParams: ParamDef[] = [
	{
		description:
			"Only traces with a span whose name, or whose trace id, matches",
		name: "q",
	},
	{
		description: "error to keep only traces with a failed span",
		name: "status",
	},
	{
		description:
			"started, duration or spans, with a leading - for descending (default -started)",
		name: "sort",
	},
	{ description: "1-based page number (default 1)", name: "page" },
	{ description: "Traces per page (default 50, max 200)", name: "perPage" },
];

export const traceRoutes: RouteDef[] = [
	{
		description:
			"The service's OpenTelemetry traces (when its traces are on), newest first. Paginated like the other lists: the body is the page, x-total-count, x-page and x-per-page carry the rest.",
		method: "get",
		path: "/services/{serviceId}/traces",
		pathParams: [serviceIdParam],
		queryParams: listParams,
		responses: {
			200: {
				description: "One page of traces",
				isArray: true,
				schema: traceSummaryResponse,
			},
			401: unauthorized,
			404: { description: "Service not found", schema: errorResponse },
		},
		summary: "List a service's traces",
		tags: ["Traces"],
	},
	{
		description:
			"Every span of one of the service's traces, the spans other services added to it included.",
		method: "get",
		path: "/services/{serviceId}/traces/{traceId}",
		pathParams: [serviceIdParam, traceIdParam],
		responses: {
			200: { description: "The trace", schema: traceResponse },
			401: unauthorized,
			404: {
				description: "Service or trace not found",
				schema: errorResponse,
			},
		},
		summary: "Get a service's trace",
		tags: ["Traces"],
	},
	{
		description:
			"Homerun's own traces (the worker's jobs: deploys, builds, backups, and CI pipeline runs filed under no service), newest first. Paginated like the other lists.",
		method: "get",
		path: "/monitoring/traces",
		queryParams: listParams,
		responses: {
			200: {
				description: "One page of traces",
				isArray: true,
				schema: traceSummaryResponse,
			},
			401: unauthorized,
		},
		summary: "List Homerun's own traces",
		tags: ["Traces"],
	},
	{
		description:
			"Every span of one of Homerun's own traces; a job's log lines are its spans' events.",
		method: "get",
		path: "/monitoring/traces/{traceId}",
		pathParams: [traceIdParam],
		responses: {
			200: { description: "The trace", schema: traceResponse },
			401: unauthorized,
			404: { description: "Trace not found", schema: errorResponse },
		},
		summary: "Get one of Homerun's own traces",
		tags: ["Traces"],
	},
	{
		description:
			"Homerun's own warnings and errors about the service (failed deploys, health checks, its container), newest first: the Errors tab's App errors.",
		method: "get",
		path: "/services/{serviceId}/app-errors",
		pathParams: [serviceIdParam],
		queryParams: [
			{ description: "How many entries, 1 to 500 (default 50)", name: "limit" },
		],
		responses: {
			200: {
				description: "The entries",
				isArray: true,
				schema: appLogResponse.omit({ serviceName: true }),
			},
			400: { description: "An invalid limit", schema: errorResponse },
			401: unauthorized,
			404: { description: "Service not found", schema: errorResponse },
		},
		summary: "List a service's app errors",
		tags: ["Errors"],
	},
];
