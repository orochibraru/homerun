import { z } from "zod";
import {
	createServiceApiBody,
	createStackApiBody,
	updateChannelApiBody,
	updateServiceApiBody,
} from "$lib/server/validation/api";
import {
	deployResultResponse,
	errorResponse,
	imageScanResponse,
	imageScanSummaryResponse,
	instanceUpdateChannelResponse,
	instanceUpdateProgressResponse,
	instanceUpdateStartResponse,
	instanceUpdateStatusResponse,
	jobResponse,
	pushWebhookResponse,
	queuedJobResponse,
	revisionResponse,
	scanConflictResponse,
	serviceResponse,
	stackResponse,
	successResponse,
	systemStatsResponse,
	templateResponse,
} from "./schemas";

export interface ResponseDef {
	description: string;
	schema?: z.ZodType;
	isArray?: boolean;
	contentType?: "application/json" | "text/plain";
}

export interface ParamDef {
	name: string;
	description: string;
}

export interface RouteDef {
	method: "get" | "post" | "patch" | "delete";
	path: string;
	tags: string[];
	summary: string;
	description?: string;
	pathParams?: ParamDef[];
	queryParams?: ParamDef[];
	requestBody?: z.ZodType;
	responses: Record<number, ResponseDef>;
}

const listQueryParams: ParamDef[] = [
	{ description: "1-based page number (default 1)", name: "page" },
	{
		description: "Items per page (default 100, max 100)",
		name: "perPage",
	},
	{ description: "Case-insensitive search term", name: "q" },
];

const notFound: ResponseDef = {
	description: "Not found",
	schema: errorResponse,
};
const unauthorized: ResponseDef = {
	description: "Unauthorized",
	schema: errorResponse,
};
const badRequest: ResponseDef = {
	description: "Invalid request body",
	schema: errorResponse,
};

/**
 * Every route under `src/routes/api/v1/**` that's meant to be part of the
 * public API surface (auth-check, git-provider OAuth round-trip, and the
 * agent's own routes are deliberately excluded : internal/unauthenticated-
 * by-design or not part of this app at all). This is a hand-maintained list,
 * not derived from the filesystem : SvelteKit route files don't carry
 * metadata (summary/tags/params) anywhere else, so there's no way to
 * generate this automatically without duplicating that metadata into the
 * route files themselves. Keep it in sync when a route's shape changes;
 * `$lib/openapi/build.ts` uses the *real* request-body zod schemas from
 * `validation/api.ts`, so at least the request side can't silently drift.
 */
export const routes: RouteDef[] = [
	{
		description:
			"Paginated. The response body is the page's items; the total row count, current page and page size come back in the x-total-count, x-page and x-per-page headers.",
		method: "get",
		path: "/services",
		queryParams: listQueryParams,
		responses: {
			200: {
				description: "Every service on the instance",
				isArray: true,
				schema: serviceResponse,
			},
			401: unauthorized,
		},
		summary: "List services",
		tags: ["Services"],
	},
	{
		description:
			"Persists config only : does not deploy. Call POST /services/{serviceId}/deploy afterward to actually pull/build and start it.",
		method: "post",
		path: "/services",
		requestBody: createServiceApiBody,
		responses: {
			201: { description: "Created", schema: serviceResponse },
			400: badRequest,
			401: unauthorized,
			409: { description: "Slug already in use", schema: errorResponse },
		},
		summary: "Create a service",
		tags: ["Services"],
	},
	{
		method: "get",
		path: "/services/{serviceId}",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		responses: {
			200: { description: "The service", schema: serviceResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Get a service",
		tags: ["Services"],
	},
	{
		method: "patch",
		path: "/services/{serviceId}",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		requestBody: updateServiceApiBody,
		responses: {
			200: { description: "Updated", schema: serviceResponse },
			400: badRequest,
			401: unauthorized,
			404: notFound,
		},
		summary: "Update a service (partial)",
		tags: ["Services"],
	},
	{
		description:
			"Removes the container or swarm service first, same as the Settings danger-zone action. One Docker reports as already gone counts as removed; any other removal failure answers 409 and deletes nothing, unless force=true.",
		method: "delete",
		path: "/services/{serviceId}",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		queryParams: [
			{
				description:
					"true deletes the service record even when its container or swarm service couldn't be removed",
				name: "force",
			},
		],
		responses: {
			204: { description: "Deleted" },
			401: unauthorized,
			404: notFound,
			409: {
				description:
					"The container or swarm service couldn't be removed, nothing was deleted",
				schema: errorResponse,
			},
		},
		summary: "Delete a service",
		tags: ["Services"],
	},
	{
		description:
			"Awaits the full pull-or-build → create → start pipeline and returns once it's done : no separate polling endpoint for API clients.",
		method: "post",
		path: "/services/{serviceId}/deploy",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		responses: {
			200: { description: "Deploy finished", schema: deployResultResponse },
			401: unauthorized,
			404: notFound,
			500: { description: "Deploy failed", schema: deployResultResponse },
		},
		summary: "Deploy a service",
		tags: ["Services"],
	},
	{
		description:
			"One entry per revision, newest first by when it was first deployed, from the last 50 deploys that reached running, with the exact image it ran. A rollback folds into the revision it redeployed (lastDeployedAt, latestDeploymentId, redeployCount) instead of adding an entry, so the order never changes. current marks the one running now, previous the default rollback target.",
		method: "get",
		path: "/services/{serviceId}/revisions",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		responses: {
			200: {
				description: "The service's revisions",
				isArray: true,
				schema: revisionResponse,
			},
			401: unauthorized,
			404: notFound,
		},
		summary: "List a service's revisions",
		tags: ["Revisions"],
	},
	{
		description:
			"Redeploys that revision's exact image (by digest when known, else the retained local build) without building, pulling from upstream or scanning, and waits for the deploy like POST /services/{serviceId}/deploy. Pass previous as revisionId for the default rollback target. Only the image is rolled back unless restoreConfig=true, which also puts back the env vars, resources and networking that revision ran with.",
		method: "post",
		path: "/services/{serviceId}/revisions/{revisionId}/deploy",
		pathParams: [
			{ description: "Service id", name: "serviceId" },
			{
				description: "Revision (deployment) id, or previous",
				name: "revisionId",
			},
		],
		queryParams: [
			{
				description:
					"true to also restore the revision's env vars, resources and networking (default false)",
				name: "restoreConfig",
			},
		],
		responses: {
			200: { description: "Deploy finished", schema: deployResultResponse },
			400: {
				description: "No previous revision to roll back to",
				schema: errorResponse,
			},
			401: unauthorized,
			404: notFound,
			500: { description: "Deploy failed", schema: deployResultResponse },
		},
		summary: "Deploy a revision (roll back)",
		tags: ["Revisions"],
	},
	{
		description:
			"The service's combined stdout/stderr as plain text, from its container or every task of its swarm service. Returns the last tail lines and closes, unless follow=true, which keeps the response open and streams new lines as they're written.",
		method: "get",
		path: "/services/{serviceId}/logs",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		queryParams: [
			{
				description:
					"How many lines of backlog to return, 1 to 10000 (default 200)",
				name: "tail",
			},
			{
				description: "true to keep streaming new lines (default false)",
				name: "follow",
			},
		],
		responses: {
			200: {
				contentType: "text/plain",
				description: "The service's logs",
				schema: z.string(),
			},
			400: {
				description: "Not deployed yet, or an invalid tail",
				schema: errorResponse,
			},
			401: unauthorized,
			404: notFound,
		},
		summary: "Read a service's logs",
		tags: ["Services"],
	},
	{
		method: "post",
		path: "/services/{serviceId}/start",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		responses: {
			200: { description: "Started", schema: successResponse },
			400: { description: "Not deployed yet", schema: errorResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Start a service's container",
		tags: ["Services"],
	},
	{
		method: "post",
		path: "/services/{serviceId}/stop",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		responses: {
			200: { description: "Stopped", schema: successResponse },
			400: { description: "Not deployed yet", schema: errorResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Stop a service's container",
		tags: ["Services"],
	},
	{
		method: "post",
		path: "/services/{serviceId}/restart",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		responses: {
			200: { description: "Restarted", schema: successResponse },
			400: { description: "Not deployed yet", schema: errorResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Restart a service's container",
		tags: ["Services"],
	},
	{
		description:
			"Newest first, without findings. Paginated like the other lists: the total row count, current page and page size come back in the x-total-count, x-page and x-per-page headers. q matches the image ref, digest, status or source.",
		method: "get",
		path: "/services/{serviceId}/scans",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		queryParams: listQueryParams,
		responses: {
			200: {
				description: "The service's image scans",
				isArray: true,
				schema: imageScanSummaryResponse,
			},
			401: unauthorized,
			404: notFound,
		},
		summary: "List a service's image scans",
		tags: ["Image scans"],
	},
	{
		description:
			"Queues a scan of the service's deployed image. Poll GET /jobs/{jobId} until it finishes, then read GET /services/{serviceId}/scans/latest.",
		method: "post",
		path: "/services/{serviceId}/scans",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		responses: {
			202: { description: "Scan queued", schema: queuedJobResponse },
			400: { description: "Not deployed yet", schema: errorResponse },
			401: unauthorized,
			404: notFound,
			409: {
				description: "A scan is already queued or running",
				schema: scanConflictResponse,
			},
		},
		summary: "Scan a service's deployed image",
		tags: ["Image scans"],
	},
	{
		description:
			"The URL and secret a git provider sends push events to when deploy-on-push is on, and whether Homerun registered the webhook itself. Add it by hand in the repository's settings when registered is false.",
		method: "get",
		path: "/services/{serviceId}/webhook",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		responses: {
			200: { description: "The push webhook", schema: pushWebhookResponse },
			401: unauthorized,
			404: {
				description: "Service not found, or deploy-on-push is off",
				schema: errorResponse,
			},
		},
		summary: "Get a service's push-to-deploy webhook",
		tags: ["Services"],
	},
	{
		method: "get",
		path: "/services/{serviceId}/scans/latest",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		responses: {
			200: { description: "The newest scan", schema: imageScanResponse },
			401: unauthorized,
			404: {
				description: "Service not found, or never scanned",
				schema: errorResponse,
			},
		},
		summary: "Get a service's latest image scan, with findings",
		tags: ["Image scans"],
	},
	{
		method: "get",
		path: "/services/{serviceId}/scans/{scanId}",
		pathParams: [
			{ description: "Service id", name: "serviceId" },
			{ description: "Scan id", name: "scanId" },
		],
		responses: {
			200: { description: "The scan", schema: imageScanResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Get an image scan, with findings",
		tags: ["Image scans"],
	},
	{
		method: "get",
		path: "/jobs/{jobId}",
		pathParams: [{ description: "Job id", name: "jobId" }],
		responses: {
			200: { description: "The job", schema: jobResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Get a queued job's status",
		tags: ["Jobs"],
	},
	{
		description:
			"Paginated. The response body is the page's items; the total row count, current page and page size come back in the x-total-count, x-page and x-per-page headers.",
		method: "get",
		path: "/stacks",
		queryParams: listQueryParams,
		responses: {
			200: {
				description: "Every stack on the instance",
				isArray: true,
				schema: stackResponse,
			},
			401: unauthorized,
		},
		summary: "List stacks",
		tags: ["Stacks"],
	},
	{
		method: "post",
		path: "/stacks",
		requestBody: createStackApiBody,
		responses: {
			201: { description: "Created", schema: stackResponse },
			400: badRequest,
			401: unauthorized,
			409: { description: "Slug already in use", schema: errorResponse },
		},
		summary: "Create a stack",
		tags: ["Stacks"],
	},
	{
		description:
			"Paginated. The response body is the page's items; the total row count, current page and page size come back in the x-total-count, x-page and x-per-page headers.",
		method: "get",
		path: "/templates",
		queryParams: listQueryParams,
		responses: {
			200: {
				description: "Built-in and custom templates",
				isArray: true,
				schema: templateResponse,
			},
			401: unauthorized,
		},
		summary: "List templates usable by the caller",
		tags: ["Templates"],
	},
	{
		description:
			"The running version, the latest GitHub release, and whether a self-update could start now (the same checks as the sidebar's update dialog). Admins only.",
		method: "get",
		path: "/instance/update",
		responses: {
			200: {
				description: "Update status",
				schema: instanceUpdateStatusResponse,
			},
			401: unauthorized,
			403: { description: "Not an admin", schema: errorResponse },
		},
		summary: "Instance update status",
		tags: ["Meta"],
	},
	{
		description:
			"Starts updating this instance to the latest release, like the sidebar's Update now: a helper container pulls the new image and recreates the Homerun container, so the API goes away for a moment. Answers once the helper has started; follow it with GET /instance/update/progress, or poll GET /instance/update until current is the returned version. Admins only.",
		method: "post",
		path: "/instance/update",
		responses: {
			202: {
				description: "Update started",
				schema: instanceUpdateStartResponse,
			},
			401: unauthorized,
			403: { description: "Not an admin", schema: errorResponse },
			409: {
				description:
					"Already on the latest release, not running under Docker Compose, or a deploy or job is in flight",
				schema: errorResponse,
			},
		},
		summary: "Update the instance",
		tags: ["Meta"],
	},
	{
		description:
			"The update helper container's state and output, to follow an update started with POST /instance/update. The helper outlives the Homerun container it recreates, so this keeps answering once the new version is up; it fails for a moment while the container restarts. Admins only.",
		method: "get",
		path: "/instance/update/progress",
		responses: {
			200: {
				description: "Update progress",
				schema: instanceUpdateProgressResponse,
			},
			401: unauthorized,
			403: { description: "Not an admin", schema: errorResponse },
		},
		summary: "Instance update progress",
		tags: ["Meta"],
	},
	{
		description:
			"Sets the release channel self-update follows, like Settings → General → Release channel. Switching from canary back to stable never downgrades: updates just stop until a stable release is newer than the running canary. Admins only.",
		method: "patch",
		path: "/instance/update/channel",
		requestBody: updateChannelApiBody,
		responses: {
			200: {
				description: "Channel saved",
				schema: instanceUpdateChannelResponse,
			},
			400: { description: "Unknown channel", schema: errorResponse },
			401: unauthorized,
			403: { description: "Not an admin", schema: errorResponse },
		},
		summary: "Set the update channel",
		tags: ["Meta"],
	},
	{
		method: "get",
		path: "/system-stats",
		responses: {
			200: {
				description: "Host CPU/RAM/disk/GPU stats",
				schema: systemStatsResponse,
			},
			401: unauthorized,
		},
		summary: "Host resource stats",
		tags: ["Meta"],
	},
	{
		description:
			"Revokes the API key that authenticated this request (x-api-key or Authorization: Bearer), what homerun logout calls server-side before clearing its local config. success is false when the key was already invalid.",
		method: "delete",
		path: "/auth-token",
		responses: {
			200: {
				description: "Revoked (or already invalid)",
				schema: successResponse,
			},
			400: {
				description: "Not authenticated with an API key",
				schema: errorResponse,
			},
			401: unauthorized,
		},
		summary: "Revoke the current API key",
		tags: ["Meta"],
	},
];
