import {
	type CallToolResult,
	createMcpHandler,
	McpServer,
} from "@modelcontextprotocol/server";
import type { RequestEvent } from "@sveltejs/kit";
import { z } from "zod";
import { config } from "$lib/config";
import { MCP_PATH, mcpAllowed } from "$lib/oidc-provider";
import { APP_VERSION } from "$lib/server/app-version";
import { allowLongRequest } from "$lib/server/long-request";
import { REDACTED, redactText, restoreRedacted } from "$lib/server/mcp-redact";

export type ApiCall = (
	method: "DELETE" | "GET" | "PATCH" | "POST",
	path: string,
	body?: unknown,
) => Promise<Response>;

const INSTRUCTIONS = `Homerun is a self-hosted PaaS: each service is one Docker container or swarm service, routed by Traefik at its domains.

To diagnose a service: find its id with list_services, read get_service (status, container and swarm ids) and get_service_config (its settings grouped like the dashboard tabs), then service_logs, list_deployments (each deploy attempt's error and log, the place to look when a deploy failed) and list_revisions (each revision's health and the reason it failed). Swarm logs can interleave every task generation, dead ones included, so check timestamps before blaming a line on the running task. Services in one stack reach each other by slug on the stack's network.

To fix one: update_service changes settings (applied on the next deploy), deploy_service rolls them out, restart_service restarts without redeploying, rollback_service redeploys an earlier revision. Say what you're about to change before changing it.`;

const serviceId = z.string().describe("The service's id, from list_services");
const read = { openWorldHint: false, readOnlyHint: true };
const change = { destructiveHint: false, openWorldHint: false };

/** The API's answer as a tool result: its body as text with secrets redacted, flagged as an error on a non-2xx status. */
async function asResult(response: Response): Promise<CallToolResult> {
	const text = redactText(await response.text());
	return {
		content: [
			{
				text: response.ok ? text : `HTTP ${response.status}: ${text}`,
				type: "text",
			},
		],
		isError: !response.ok,
	};
}

/** A path under a service, with its id escaped. */
function servicePath(id: string, suffix = ""): string {
	return `/services/${encodeURIComponent(id)}${suffix}`;
}

/** Registers the tool that reads a service's deploy attempts, failed ones included. */
function registerDeploymentTools(server: McpServer, api: ApiCall): void {
	server.registerTool(
		"list_deployments",
		{
			annotations: read,
			description:
				"A service's latest deploy attempts, newest first, failed ones included: each one's status, error and progress log. Read this when a deploy failed, since a deploy that never started a container leaves nothing in service_logs.",
			inputSchema: z.object({
				limit: z
					.number()
					.int()
					.min(1)
					.max(50)
					.optional()
					.describe("How many deployments to return (default 10)"),
				serviceId,
			}),
		},
		async ({ limit, serviceId: id }) =>
			asResult(
				await api(
					"GET",
					servicePath(id, `/deployments${limit ? `?limit=${limit}` : ""}`),
				),
			),
	);
}

/** Registers the tools that read one service or find it: list, record, config, logs and revisions. */
function registerReadTools(server: McpServer, api: ApiCall): void {
	server.registerTool(
		"list_services",
		{
			annotations: read,
			description:
				"List services with their id, name, slug, image, tag, status and stack.",
			inputSchema: z.object({
				search: z
					.string()
					.optional()
					.describe("Only services whose name or slug matches this term"),
			}),
		},
		async ({ search }) => {
			const query = new URLSearchParams({ perPage: "100" });
			if (search) {
				query.set("q", search);
			}
			const response = await api("GET", `/services?${query}`);
			if (!response.ok) {
				return await asResult(response);
			}
			const rows = (await response.json()) as Record<string, unknown>[];
			const summary = rows.map((row) => ({
				currentStatus: row.currentStatus,
				id: row.id,
				image: row.image,
				name: row.name,
				slug: row.slug,
				stackId: row.stackId,
				tag: row.tag,
			}));
			return { content: [{ text: JSON.stringify(summary), type: "text" }] };
		},
	);

	server.registerTool(
		"get_service",
		{
			annotations: read,
			description:
				"A service's full record: status, container and swarm ids, image, domains and every setting as stored. Env var values are redacted.",
			inputSchema: z.object({ serviceId }),
		},
		async ({ serviceId: id }) => asResult(await api("GET", servicePath(id))),
	);

	server.registerTool(
		"get_service_config",
		{
			annotations: read,
			description:
				"A service's settings grouped by dashboard tab (source, env, volumes, networking, compute, runtime, security, settings). Env var values are redacted.",
			inputSchema: z.object({ serviceId }),
		},
		async ({ serviceId: id }) =>
			asResult(await api("GET", servicePath(id, "/config"))),
	);

	server.registerTool(
		"service_logs",
		{
			annotations: read,
			description:
				"The latest lines of a service's container or swarm task logs.",
			inputSchema: z.object({
				serviceId,
				tail: z
					.number()
					.int()
					.min(1)
					.max(10_000)
					.optional()
					.describe("How many of the latest lines to return (default 200)"),
			}),
		},
		async ({ serviceId: id, tail }) =>
			asResult(
				await api(
					"GET",
					servicePath(id, `/logs${tail ? `?tail=${tail}` : ""}`),
				),
			),
	);

	server.registerTool(
		"list_revisions",
		{
			annotations: read,
			description:
				"A service's deployed revisions, newest first, with each one's image, health and failure reason.",
			inputSchema: z.object({ serviceId }),
		},
		async ({ serviceId: id }) =>
			asResult(await api("GET", servicePath(id, "/revisions"))),
	);
}

/** Registers the read-only tools about the whole instance: stacks, host usage and version. */
function registerInstanceTools(server: McpServer, api: ApiCall): void {
	server.registerTool(
		"list_stacks",
		{
			annotations: read,
			description: "List stacks, the groups services share a network in.",
		},
		async () => asResult(await api("GET", "/stacks?perPage=100")),
	);

	server.registerTool(
		"system_stats",
		{
			annotations: read,
			description: "The host's CPU, memory and disk usage.",
		},
		async () => asResult(await api("GET", "/system-stats")),
	);

	server.registerTool(
		"instance_status",
		{
			annotations: read,
			description:
				"The instance's running version, release channel and whether an update is available.",
		},
		async () => asResult(await api("GET", "/instance/update")),
	);
}

/**
 * Patches a service for `update_service`, first restoring any env var the
 * agent sent back as `REDACTED` to its stored value.
 */
async function updateService(
	api: ApiCall,
	id: string,
	changes: Record<string, unknown>,
): Promise<CallToolResult> {
	if (!(changes.envVars && typeof changes.envVars === "object")) {
		return asResult(await api("PATCH", servicePath(id), changes));
	}
	const current = await api("GET", servicePath(id));
	if (!current.ok) {
		return asResult(current);
	}
	const { envVars } = (await current.json()) as {
		envVars: Record<string, string>;
	};
	return asResult(
		await api("PATCH", servicePath(id), {
			...changes,
			envVars: restoreRedacted(
				changes.envVars as Record<string, unknown>,
				envVars,
			),
		}),
	);
}

/** Registers the tools that change a service: settings, deploy, restart/start/stop and rollback. */
function registerChangeTools(server: McpServer, api: ApiCall): void {
	server.registerTool(
		"update_service",
		{
			annotations: change,
			description:
				"Change a service's settings. Takes effect on its next deploy_service.",
			inputSchema: z.object({
				changes: z
					.record(z.string(), z.unknown())
					.describe(
						`The fields to change, as PATCH /services/{serviceId} takes them, e.g. {"envVars": {"KEY": "value"}} (envVars replaces the whole map, so send every var; a var left as "${REDACTED}" keeps its stored value)`,
					),
				serviceId,
			}),
		},
		({ changes, serviceId: id }) => updateService(api, id, changes),
	);

	server.registerTool(
		"deploy_service",
		{
			annotations: change,
			description:
				"Deploy a service with its current settings and wait for the result, optionally switching its image tag first.",
			inputSchema: z.object({
				serviceId,
				tag: z
					.string()
					.optional()
					.describe("Switch an image-based service to this image tag first"),
			}),
		},
		async ({ serviceId: id, tag }) =>
			asResult(
				await api(
					"POST",
					servicePath(id, "/deploy"),
					tag ? { tag } : undefined,
				),
			),
	);

	for (const [action, verb] of [
		["restart", "Restart"],
		["start", "Start"],
		["stop", "Stop"],
	] as const) {
		server.registerTool(
			`${action}_service`,
			{
				annotations: change,
				description: `${verb} a service's container or swarm service, without redeploying it.`,
				inputSchema: z.object({ serviceId }),
			},
			async ({ serviceId: id }) =>
				asResult(await api("POST", servicePath(id, `/${action}`))),
		);
	}

	server.registerTool(
		"rollback_service",
		{
			annotations: change,
			description:
				"Redeploy one of a service's earlier revisions (default: the previous one) and wait for it.",
			inputSchema: z.object({
				restoreConfig: z
					.boolean()
					.optional()
					.describe(
						"Also restore the env vars, resources and networking that revision ran with",
					),
				revisionId: z
					.string()
					.optional()
					.describe("The revision to redeploy, from list_revisions"),
				serviceId,
			}),
		},
		async ({ restoreConfig, revisionId, serviceId: id }) =>
			asResult(
				await api(
					"POST",
					servicePath(
						id,
						`/revisions/${encodeURIComponent(revisionId ?? "previous")}/deploy${restoreConfig ? "?restoreConfig=true" : ""}`,
					),
				),
			),
	);
}

/**
 * Homerun's MCP server: tools for an AI agent to diagnose and fix services,
 * each one a call to the REST API through `api`, so they run with the caller's
 * own permissions (a developer or read-only key can't do more here than on
 * the API). Deleting a service is deliberately not a tool.
 */
export function createHomerunMcpServer(api: ApiCall): McpServer {
	const server = new McpServer(
		{ name: "homerun", version: APP_VERSION },
		{ instructions: INSTRUCTIONS },
	);
	registerReadTools(server, api);
	registerDeploymentTools(server, api);
	registerInstanceTools(server, api);
	registerChangeTools(server, api);
	return server;
}

const FORWARDED_AUTH_HEADERS = ["authorization", "cookie", "x-api-key"];

/**
 * Serves one MCP request for the signed-in caller: an OAuth access token from
 * an MCP client like claude.ai, an API key, or a dashboard session, all of
 * which `hooks.server.ts` has already turned into `locals.user`. Anyone else
 * gets the 401 whose `WWW-Authenticate` points MCP clients at the protected
 * resource metadata, which is how they find where to sign in. Tool calls go
 * back through the REST API with the caller's own credentials.
 */
export async function serveMcp(event: RequestEvent): Promise<Response> {
	const { fetch, locals, platform, request } = event;
	if (!(config.auth.origin && mcpAllowed(config.auth.origin))) {
		return new Response(
			JSON.stringify({
				error:
					"The MCP server needs the dashboard served over HTTPS: set its URL to an https:// one in Settings → General.",
			}),
			{ headers: { "content-type": "application/json" }, status: 404 },
		);
	}
	if (!locals.user) {
		const origin = config.auth.origin?.replace(/\/+$/, "");
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			headers: {
				"content-type": "application/json",
				"www-authenticate": origin
					? `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}"`
					: "Bearer",
			},
			status: 401,
		});
	}
	allowLongRequest(platform);
	const credentials = new Headers();
	for (const name of FORWARDED_AUTH_HEADERS) {
		const value = request.headers.get(name);
		if (value) {
			credentials.set(name, value);
		}
	}
	const api: ApiCall = (method, path, body) => {
		const headers = new Headers(credentials);
		if (body !== undefined) {
			headers.set("content-type", "application/json");
		}
		const init: RequestInit = { headers, method };
		if (body !== undefined) {
			init.body = JSON.stringify(body);
		}
		return fetch(`/api/v1${path}`, init);
	};
	return await createMcpHandler(() => createHomerunMcpServer(api)).fetch(
		request,
	);
}
