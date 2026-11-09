import { createHmac } from "node:crypto";

import type { WebhookRequest } from "#lib/git-webhooks.js";

import type { PipelineProvider } from "./types.ts";

export const PIPELINE_WEBHOOK_PATH = "/api/v1/webhooks/pipelines";

const WORKFLOW_EVENTS = ["workflow_run", "workflow_job"];

const GITLAB_EVENTS = new Set(["Pipeline Hook", "Job Hook"]);

/** The URL a provider delivers a watched repository's CI events to. */
export function pipelineWebhookUrl(
	origin: string,
	repositoryId: string,
): string {
	return `${origin.replace(/\/+$/, "")}${PIPELINE_WEBHOOK_PATH}/${repositoryId}`;
}

/**
 * The secret a watched repository's CI webhook is signed with: an HMAC of
 * its id with the auth secret, so nothing has to be stored and one
 * repository's secret says nothing about another's.
 */
export function pipelineWebhookSecret(
	authSecret: string,
	repositoryId: string,
): string {
	return createHmac("sha256", authSecret)
		.update(`homerun-pipeline-webhook:${repositoryId}`)
		.digest("hex");
}

/**
 * The provider call that registers a webhook delivering only CI events to
 * `hook.url`: GitHub's and Gitea's `workflow_run` and `workflow_job` (Gitea
 * sends them from 1.24 on), GitLab's pipeline and job events.
 */
export function pipelineWebhookRequest(
	kind: PipelineProvider,
	repo: string,
	hook: { secret: string; url: string },
): WebhookRequest {
	const { secret, url } = hook;
	if (kind === "gitlab") {
		return {
			body: {
				enable_ssl_verification: true,
				job_events: true,
				pipeline_events: true,
				push_events: false,
				token: secret,
				url,
			},
			method: "POST",
			path: `/projects/${encodeURIComponent(repo)}/hooks`,
		};
	}
	return {
		body: {
			active: true,
			config:
				kind === "github"
					? { content_type: "json", insecure_ssl: "0", secret, url }
					: { content_type: "json", secret, url },
			events: WORKFLOW_EVENTS,
			...(kind === "gitea" ? { type: "gitea" } : { name: "web" }),
		},
		method: "POST",
		path: `/repos/${repo}/hooks`,
	};
}

/** Whether a delivery is a CI event (a workflow run or job, a GitLab pipeline or job), rather than a ping or anything else. */
export function isPipelineEvent(headers: Headers): boolean {
	const workflowEvent =
		headers.get("x-gitea-event") ?? headers.get("x-github-event");
	if (workflowEvent) {
		return WORKFLOW_EVENTS.includes(workflowEvent);
	}
	return GITLAB_EVENTS.has(headers.get("x-gitlab-event") ?? "");
}
