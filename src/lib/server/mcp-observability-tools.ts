import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { type ApiCall, asResult, read } from "#lib/server/mcp-tool-kit.js";

const SORTS = {
	most_spans: "-spans",
	newest: "-started",
	slowest: "-duration",
} as const;

interface StoredSpan {
	resourceAttributes?: Record<string, unknown>;
	serviceName?: string;
	[key: string]: unknown;
}

/** Where a service's traces live, or Homerun's own when no service is given. */
function tracesPath(serviceId: string | undefined, suffix = ""): string {
	return serviceId
		? `/services/${encodeURIComponent(serviceId)}/traces${suffix}`
		: `/monitoring/traces${suffix}`;
}

/** A page of a paginated list as one JSON body, with the total the API sends in its headers. */
async function withTotal(response: Response, key: string): Promise<Response> {
	if (!response.ok) {
		return response;
	}
	return Response.json({
		[key]: await response.json(),
		page: Number(response.headers.get("x-page") ?? 1),
		total: Number(response.headers.get("x-total-count") ?? 0),
	});
}

/** A trace with each service's resource attributes stated once instead of on every span. */
async function compactTrace(response: Response): Promise<Response> {
	if (!response.ok) {
		return response;
	}
	const trace = (await response.json()) as {
		spans: StoredSpan[];
		traceId: string;
	};
	const resources: Record<string, Record<string, unknown>> = {};
	const spans = trace.spans.map(({ resourceAttributes, ...span }) => {
		resources[span.serviceName ?? ""] ??= resourceAttributes ?? {};
		return span;
	});
	return Response.json({ resources, spans, traceId: trace.traceId });
}

/** Registers the tools that list traces and read one, a service's or Homerun's own. */
function registerTraceTools(server: McpServer, api: ApiCall): void {
	const serviceId = z
		.string()
		.optional()
		.describe(
			"The service's id, from list_services; leave it out for Homerun's own traces (its worker's deploys, builds, backups and other jobs)",
		);

	server.registerTool(
		"list_traces",
		{
			annotations: read,
			description:
				"OpenTelemetry traces, a service's (when its traces are on) or Homerun's own, newest first: each one's trace id, root span name, service, start, duration, span count and failed span count, plus the total matching.",
			inputSchema: z.object({
				errorsOnly: z
					.boolean()
					.optional()
					.describe("Only traces with a failed span"),
				page: z.number().int().min(1).optional().describe("1-based page"),
				perPage: z
					.number()
					.int()
					.min(1)
					.max(200)
					.optional()
					.describe("Traces per page (default 50)"),
				q: z
					.string()
					.optional()
					.describe(
						"Only traces with a span whose name, or whose trace id, matches",
					),
				serviceId,
				sort: z
					.enum(["newest", "slowest", "most_spans"])
					.optional()
					.describe("Order (default newest)"),
			}),
		},
		async ({ errorsOnly, page, perPage, q, serviceId: id, sort }) => {
			const query = new URLSearchParams();
			if (q) {
				query.set("q", q);
			}
			if (errorsOnly) {
				query.set("status", "error");
			}
			if (sort) {
				query.set("sort", SORTS[sort]);
			}
			if (page) {
				query.set("page", String(page));
			}
			if (perPage) {
				query.set("perPage", String(perPage));
			}
			const suffix = query.size > 0 ? `?${query}` : "";
			return asResult(
				await withTotal(await api("GET", tracesPath(id, suffix)), "traces"),
			);
		},
	);

	server.registerTool(
		"get_trace",
		{
			annotations: read,
			description:
				"Every span of one trace, in start order, from every service that took part: name, span and parent ids, start, duration, status (2 is an error) with its message, attributes and events (a Homerun job's log lines are its spans' events), plus each service's resource attributes once. Read this to see where a slow or failed request or job spent its time.",
			inputSchema: z.object({
				serviceId: z
					.string()
					.optional()
					.describe(
						"The service whose trace it is, as given to list_traces; leave it out for one of Homerun's own",
					),
				traceId: z.string().describe("The trace id, from list_traces"),
			}),
		},
		async ({ serviceId: id, traceId }) =>
			asResult(
				await compactTrace(
					await api("GET", tracesPath(id, `/${encodeURIComponent(traceId)}`)),
				),
			),
	);
}

/** Registers the tools that read traces and Homerun's own errors about a service. */
export function registerObservabilityTools(
	server: McpServer,
	api: ApiCall,
): void {
	registerTraceTools(server, api);
	server.registerTool(
		"list_app_errors",
		{
			annotations: read,
			description:
				"Homerun's own warnings and errors about a service, newest first (failed deploys, health checks, its container misbehaving): what the dashboard's Errors → App errors tab shows. Unlike list_system_logs, needs no System access.",
			inputSchema: z.object({
				limit: z
					.number()
					.int()
					.min(1)
					.max(500)
					.optional()
					.describe("How many entries (default 50)"),
				serviceId: z.string().describe("The service's id, from list_services"),
			}),
		},
		async ({ limit, serviceId: id }) =>
			asResult(
				await api(
					"GET",
					`/services/${encodeURIComponent(id)}/app-errors${limit ? `?limit=${limit}` : ""}`,
				),
			),
	);
}
