import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { PIPELINE_STATUSES } from "#lib/pipelines/types.js";
import {
	type ApiCall,
	asResult,
	change,
	read,
} from "#lib/server/mcp-tool-kit.js";

const repositoryId = z
	.string()
	.describe("The watched repository's id, from list_repositories");
const path = (id: string, suffix = "") =>
	`/pipelines/repositories/${encodeURIComponent(id)}${suffix}`;
const runFilters = {
	query: z
		.string()
		.optional()
		.describe("Matches the workflow, branch, commit title or SHA"),
	status: z
		.array(z.enum(PIPELINE_STATUSES))
		.optional()
		.describe("Keep only runs in these statuses"),
};
const runQuery = (input: { query?: string; status?: string[] }) => {
	const params = new URLSearchParams({ perPage: "50" });
	if (input.query) {
		params.set("q", input.query);
	}
	if (input.status?.length) {
		params.set("status", input.status.join(","));
	}
	return params.toString();
};

/** Registers the tools that read CI totals and watched repositories, and sync or watch one. */
function registerRepositoryTools(server: McpServer, api: ApiCall): void {
	server.registerTool(
		"get_pipeline_stats",
		{
			annotations: read,
			description:
				"CI totals across every watched repository, over the last 30 days and all time: runs, successes and failures, p50/p95 duration, mean queue time, billable minutes and cost.",
		},
		async () => asResult(await api("GET", "/pipelines")),
	);

	server.registerTool(
		"list_repositories",
		{
			annotations: read,
			description:
				"List the repositories whose CI runs (GitHub Actions, GitLab CI, Gitea Actions) Homerun watches, each with its linked services, its 30-day totals, when it last synced and why that failed, and whether its CI webhook is registered.",
		},
		async () =>
			asResult(await api("GET", "/pipelines/repositories?perPage=100")),
	);

	server.registerTool(
		"get_repository",
		{
			annotations: read,
			description:
				"One watched repository with its CI totals over 30 days and all time, per workflow, and the runner rates its cost is computed at.",
			inputSchema: z.object({ repositoryId }),
		},
		async ({ repositoryId: id }) => asResult(await api("GET", path(id))),
	);

	server.registerTool(
		"sync_repository",
		{
			annotations: change,
			description:
				"Read a watched repository's latest CI runs from its provider now, as a background job (get_job follows it). Runs normally arrive on their own, through its CI webhook or every few minutes.",
			inputSchema: z.object({ repositoryId }),
		},
		async ({ repositoryId: id }) =>
			asResult(await api("POST", path(id, "/sync"))),
	);

	server.registerTool(
		"watch_repository",
		{
			annotations: change,
			description:
				"Start watching a repository's CI runs, read with the caller's own connection to its provider (list_git_providers gives the provider ids). Registers its CI webhook and queues a first sync.",
			inputSchema: z.object({
				defaultBranch: z.string().optional().describe("Its default branch"),
				fullName: z
					.string()
					.describe('Its path on the provider, e.g. "owner/repo"'),
				providerId: z.string().describe("The git provider's id"),
			}),
		},
		async (input) =>
			asResult(await api("POST", "/pipelines/repositories", input)),
	);
}

/** Registers the tools that list CI runs and read one with its jobs. */
function registerRunTools(server: McpServer, api: ApiCall): void {
	server.registerTool(
		"list_pipeline_runs",
		{
			annotations: read,
			description:
				"The latest 50 CI runs, newest first, of one watched repository or of all of them: workflow, status, branch, commit, duration, queue time and cost, without their jobs (get_pipeline_run has them).",
			inputSchema: z.object({
				...runFilters,
				repositoryId: repositoryId
					.optional()
					.describe(
						"Only this repository's runs; every repository's when left out",
					),
			}),
		},
		async ({ repositoryId: id, ...filters }) =>
			asResult(
				await api(
					"GET",
					`${id ? path(id, "/runs") : "/pipelines/runs"}?${runQuery(filters)}`,
				),
			),
	);

	server.registerTool(
		"get_pipeline_run",
		{
			annotations: read,
			description:
				"One CI run with every job of every attempt: runner labels, steps, timings and cost. Use it to see which job failed or what made a run slow; get_trace opens its trace with its traceId and traceServiceId (as serviceId, left out when null).",
			inputSchema: z.object({
				repositoryId,
				runId: z.string().describe("The run's id, from list_pipeline_runs"),
			}),
		},
		async ({ repositoryId: id, runId }) =>
			asResult(
				await api("GET", path(id, `/runs/${encodeURIComponent(runId)}`)),
			),
	);
}

/** Registers the tools that read watched repositories, their CI runs and stats, and sync or watch one. */
export function registerPipelineTools(server: McpServer, api: ApiCall): void {
	registerRepositoryTools(server, api);
	registerRunTools(server, api);
}
