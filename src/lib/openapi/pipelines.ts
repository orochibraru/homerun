import { z } from "zod";

import { PIPELINE_STATUSES } from "#lib/pipelines/types.js";
import { watchRepositoryApiBody } from "#lib/server/validation/api.js";

import type { ParamDef, RouteDef } from "./registry";
import { errorResponse, successResponse } from "./schemas";

const timestamp = z.string().meta({ description: "ISO 8601 timestamp" });
const unauthorized = { description: "Unauthorized", schema: errorResponse };
const notFound = { description: "Not found", schema: errorResponse };
const tags = ["Pipelines"];

const listParams: ParamDef[] = [
	{ description: "1-based page number (default 1)", name: "page" },
	{ description: "Items per page (default 100, max 200)", name: "perPage" },
	{ description: "Case-insensitive search term", name: "q" },
];

const runListParams: ParamDef[] = [
	...listParams,
	{
		description: `Comma-separated statuses to keep: ${PIPELINE_STATUSES.join(", ")}`,
		name: "status",
	},
];

const repositoryIdParam: ParamDef = {
	description: "Watched repository id",
	name: "repositoryId",
};

const pipelineStatus = z.enum(PIPELINE_STATUSES);
const pipelineProvider = z.enum(["github", "gitlab", "gitea"]);

export const pipelineStatsResponse = z.object({
	avgQueueMs: z.number().nullable().meta({
		description: "Mean time runs waited before starting",
	}),
	billableMinutes: z.number().int().meta({
		description: "Every job's minutes, each rounded up, every attempt",
	}),
	costUsd: z.number().meta({ description: "At the repository's rates" }),
	failed: z.number().int(),
	name: z.string().nullable().meta({
		description:
			"The workflow (or repository) these totals are for, null for a total",
	}),
	p50Ms: z.number().nullable().meta({ description: "Median run duration" }),
	p95Ms: z.number().nullable(),
	repositoryId: z.string().nullable(),
	runs: z.number().int(),
	succeeded: z.number().int(),
});

const linkedServiceResponse = z.object({ id: z.string(), name: z.string() });

const rateRule = z.object({
	label: z.string().meta({
		description: "Matches a job whose runner label starts with it",
	}),
	rate: z.number().meta({ description: "Dollars per minute" }),
});

const repositoryFields = {
	createdAt: timestamp,
	defaultBranch: z.string().nullable(),
	fullName: z.string().meta({
		description: 'The path on the provider, "owner/repo"',
	}),
	id: z.string(),
	linkedServices: z.array(linkedServiceResponse).meta({
		description:
			"Services showing its runs on their Pipelines tab and filing its CI traces",
	}),
	pipelineRates: z.array(rateRule).nullable().meta({
		description: "Its own runner rates, null for the provider's defaults",
	}),
	pipelinesEnabled: z.boolean().meta({
		description: "Whether its runs are synced",
	}),
	pipelinesError: z.string().nullable().meta({
		description: "Why the last sync failed",
	}),
	pipelinesSyncedAt: timestamp.nullable(),
	providerId: z.string(),
	providerKind: z.enum(["github", "gitlab", "gitea", "bitbucket"]),
	updatedAt: timestamp,
	userId: z.string().meta({
		description: "Whose connection to the provider reads it",
	}),
	webhookError: z.string().nullable().meta({
		description: "Why Homerun couldn't register its CI webhook",
	}),
	webhookId: z.string().nullable().meta({
		description:
			"The provider's id for its CI webhook, null while it's polled instead",
	}),
	webUrl: z.string(),
};

export const repositoryResponse = z.object(repositoryFields);

export const repositorySummaryResponse = z.object({
	...repositoryFields,
	stats: pipelineStatsResponse.nullable().meta({
		description: "Totals over the last 30 days, null before its first run",
	}),
});

export const repositoryDetailResponse = z.object({
	...repositoryFields,
	allTimeStats: pipelineStatsResponse,
	rates: z.array(rateRule).meta({ description: "The rates in force" }),
	ratesCustom: z.boolean().meta({
		description: "Whether those are its own rather than the defaults",
	}),
	stats: pipelineStatsResponse.meta({
		description: "Totals over the last 30 days",
	}),
	workflows: z.array(pipelineStatsResponse).meta({
		description: "The same 30-day totals per workflow, busiest first",
	}),
});

const pipelineStep = z.object({
	finishedAt: timestamp.nullable(),
	name: z.string(),
	startedAt: timestamp.nullable(),
	status: pipelineStatus,
});

const pipelineJob = z.object({
	attempt: z.number().int(),
	billableMinutes: z.number().int(),
	costUsd: z.number(),
	durationMs: z.number().nullable(),
	finishedAt: timestamp.nullable(),
	labels: z.array(z.string()).meta({ description: "Its runner labels" }),
	name: z.string(),
	runner: z.string().nullable(),
	stage: z.string().nullable().meta({ description: "GitLab's stage" }),
	startedAt: timestamp.nullable(),
	status: pipelineStatus,
	steps: z.array(pipelineStep).meta({ description: "Empty on GitLab" }),
	url: z.string().nullable(),
});

const runFields = {
	actor: z.string().nullable(),
	attempt: z.number().int(),
	billableMinutes: z.number().int(),
	branch: z.string().nullable(),
	commitSha: z.string().nullable(),
	costUsd: z.number(),
	createdAt: timestamp,
	durationMs: z.number().nullable(),
	event: z.string().nullable().meta({
		description: "What triggered it: push, pull_request, schedule...",
	}),
	externalId: z.string().meta({ description: "The provider's run id" }),
	finishedAt: timestamp.nullable(),
	id: z.string(),
	name: z.string().meta({ description: "The workflow's name" }),
	number: z.number().int().nullable(),
	provider: pipelineProvider,
	queueMs: z.number().nullable(),
	repositoryId: z.string(),
	startedAt: timestamp.nullable(),
	status: pipelineStatus,
	title: z.string().nullable().meta({ description: "The commit title" }),
	traceExported: z.boolean(),
	traceId: z.string().nullable().meta({
		description: "Its trace, once finished and exported",
	}),
	traceServiceId: z.string().nullable().meta({
		description: "The service its trace is filed under, null for Homerun's own",
	}),
	updatedAt: timestamp,
	url: z.string().nullable(),
};

export const pipelineRunSummaryResponse = z.object({
	...runFields,
	repositoryName: z.string(),
});

export const pipelineRunResponse = z.object({
	...runFields,
	jobs: z.array(pipelineJob).meta({
		description:
			"Every job of every attempt; cost sums them all, timings use the latest attempt",
	}),
});

const runsPaginated =
	"Newest first. Paginated: the body is the page, x-total-count, x-page and x-per-page carry the rest. Each run comes without its jobs, which the run's own route returns. q matches the workflow, branch, commit title or SHA and the repository.";

export const pipelineRoutes: RouteDef[] = [
	{
		description:
			"Totals over every watched repository's runs, over the last 30 days and all time.",
		method: "get",
		path: "/pipelines",
		responses: {
			200: {
				description: "CI totals",
				schema: z.object({
					allTimeStats: pipelineStatsResponse,
					repositories: z.number().int().meta({
						description: "How many repositories are watched",
					}),
					stats: pipelineStatsResponse,
					windowDays: z.number().int(),
				}),
			},
			401: unauthorized,
		},
		summary: "CI pipeline stats",
		tags,
	},
	{
		description: runsPaginated,
		method: "get",
		path: "/pipelines/runs",
		queryParams: runListParams,
		responses: {
			200: {
				description: "One page of runs",
				isArray: true,
				schema: pipelineRunSummaryResponse,
			},
			401: unauthorized,
		},
		summary: "List CI runs of every watched repository",
		tags,
	},
	{
		description:
			"Watched repositories by name, each with its linked services and 30-day totals. Paginated like every list; q matches the path.",
		method: "get",
		path: "/pipelines/repositories",
		queryParams: listParams,
		responses: {
			200: {
				description: "One page of repositories",
				isArray: true,
				schema: repositorySummaryResponse,
			},
			401: unauthorized,
		},
		summary: "List watched repositories",
		tags,
	},
	{
		description:
			"Starts watching a repository on a provider the caller is connected to (GitHub, GitLab or Gitea), read with the caller's connection: links the services building from it, registers its CI webhook and queues its first sync. A repository already watched comes back as is, with 200.",
		method: "post",
		path: "/pipelines/repositories",
		requestBody: watchRepositoryApiBody,
		responses: {
			200: { description: "Already watched", schema: repositoryResponse },
			201: { description: "Watched", schema: repositoryResponse },
			400: {
				description:
					"Invalid body, a provider that's gone or without CI, or one the caller isn't connected to",
				schema: errorResponse,
			},
			401: unauthorized,
		},
		summary: "Watch a repository",
		tags,
	},
	{
		description:
			"The repository with its totals over the last 30 days and all time, per workflow, and the rates in force.",
		method: "get",
		path: "/pipelines/repositories/{repositoryId}",
		pathParams: [repositoryIdParam],
		responses: {
			200: { description: "The repository", schema: repositoryDetailResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Get a watched repository",
		tags,
	},
	{
		description:
			"Removes its CI webhook from the provider and deletes it with its stored runs; its services are unlinked. Traces already exported stay until they expire.",
		method: "delete",
		path: "/pipelines/repositories/{repositoryId}",
		pathParams: [repositoryIdParam],
		responses: {
			200: { description: "Stopped watching", schema: successResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Stop watching a repository",
		tags,
	},
	{
		description:
			"Queues a sync of its latest runs as a background job, reusing one already queued. Poll /jobs/{jobId} for its progress.",
		method: "post",
		path: "/pipelines/repositories/{repositoryId}/sync",
		pathParams: [repositoryIdParam],
		responses: {
			202: {
				description: "Queued",
				schema: z.object({ jobId: z.string() }),
			},
			401: unauthorized,
			404: notFound,
		},
		summary: "Sync a repository's CI runs now",
		tags,
	},
	{
		description: runsPaginated,
		method: "get",
		path: "/pipelines/repositories/{repositoryId}/runs",
		pathParams: [repositoryIdParam],
		queryParams: runListParams,
		responses: {
			200: {
				description: "One page of runs",
				isArray: true,
				schema: pipelineRunSummaryResponse,
			},
			401: unauthorized,
			404: notFound,
		},
		summary: "List a repository's CI runs",
		tags,
	},
	{
		method: "get",
		path: "/pipelines/repositories/{repositoryId}/runs/{runId}",
		pathParams: [
			repositoryIdParam,
			{ description: "Run id, from the runs list", name: "runId" },
		],
		responses: {
			200: {
				description: "The run with its jobs",
				schema: pipelineRunResponse,
			},
			401: unauthorized,
			404: notFound,
		},
		summary: "Get a CI run",
		tags,
	},
	{
		description:
			"Where a provider delivers a watched repository's CI events: GitHub and Gitea workflow_run and workflow_job, GitLab pipeline and job events. Signed like a push webhook (X-Hub-Signature-256, X-Gitea-Signature, X-Gitlab-Token) with the secret on the repository's Settings tab; a verified CI event queues a sync. No API key: the signature is the authentication.",
		method: "post",
		path: "/webhooks/pipelines/{repositoryId}",
		pathParams: [repositoryIdParam],
		responses: {
			202: {
				description: "A sync was queued, or the delivery was ignored",
				schema: z.object({
					ignored: z.string().optional().meta({
						description:
							"Why nothing was queued: not a CI event, or syncing is off",
					}),
					jobId: z.string().optional(),
				}),
			},
			401: { description: "Bad signature", schema: errorResponse },
			404: notFound,
		},
		summary: "Receive a CI webhook delivery",
		tags,
	},
];
