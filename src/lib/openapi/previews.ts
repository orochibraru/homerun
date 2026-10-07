import { z } from "zod";
import {
	deployPreviewApiBody,
	promotePreviewApiBody,
} from "#lib/server/validation/api.js";
import type { RouteDef } from "./registry";
import { errorResponse, successResponse } from "./schemas";

const isoTimestamp = z.string().meta({
	description: "ISO 8601 timestamp",
	example: "2026-08-20T12:00:00.000Z",
});

const deploymentStatus = z.enum([
	"pending",
	"pulling",
	"starting",
	"running",
	"stopped",
	"failed",
	"missing",
]);

export const previewResponse = z.object({
	branch: z.string().nullable(),
	deployment: z
		.object({
			createdAt: isoTimestamp,
			errorMessage: z.string().nullable(),
			finishedAt: isoTimestamp.nullable(),
			gitCommit: z.string().nullable().meta({
				description: "The commit it built, null until the build checked it out",
			}),
			gitRef: z.string().nullable(),
			id: z.string(),
			status: deploymentStatus,
		})
		.nullable()
		.meta({
			description:
				"The preview's latest deploy attempt, failed or in flight ones included",
		}),
	gitRef: z.string().nullable().meta({
		description:
			"What a git service's preview builds: the pull request's head SHA, or its branch when the provider sent no full SHA. Null for an image-based service's preview",
	}),
	hostnames: z.array(z.string()),
	id: z.string().meta({ description: "The preview's own service id" }),
	name: z.string(),
	prNumber: z.number().int(),
	revision: z
		.object({
			deployedAt: isoTimestamp.nullable(),
			gitCommit: z.string().nullable(),
			gitRef: z.string().nullable(),
			health: z
				.enum(["watching", "healthy", "unhealthy", "rolled_back"])
				.nullable(),
			healthReason: z.string().nullable(),
			id: z.string().meta({
				description: "The revision's deployment id on the preview",
			}),
			imageDigest: z.string().nullable(),
			imageRef: z.string().nullable(),
		})
		.nullable()
		.meta({
			description:
				"The revision the preview runs now, null until a deploy of it succeeded",
		}),
	slug: z.string(),
	status: deploymentStatus.meta({
		description: "The preview service's last known status",
	}),
	title: z.string().nullable(),
	url: z.string().nullable().meta({
		description: "The preview's main URL, null when nothing routes to it",
	}),
});

export const deployPreviewResponse = previewResponse.extend({
	deploymentId: z.string().meta({
		description:
			"The preview's queued deployment. Poll GET /services/{serviceId}/previews/{prNumber} (or run homerun previews wait) until its revision is healthy",
	}),
});

export const promoteResponse = z.object({
	deploymentId: z.string().meta({
		description: "The deployment on the service the preview was promoted to",
	}),
	gitCommit: z.string().nullable(),
	imageRef: z.string().nullable(),
	jobId: z.string().meta({
		description: "The deploy job, poll GET /jobs/{jobId} to follow it",
	}),
	previewId: z.string(),
	revisionId: z.string().meta({
		description: "The preview revision whose image is deployed",
	}),
});

const servicePrParams = [
	{ description: "Service id (the preview's parent)", name: "serviceId" },
	{ description: "Pull request number", name: "prNumber" },
];

const error = (description: string) => ({
	description,
	schema: errorResponse,
});

export const previewRoutes: RouteDef[] = [
	{
		description:
			"The service's open pull request previews, newest pull request first, each with its URL, the revision it runs and its latest deploy attempt.",
		method: "get",
		path: "/services/{serviceId}/previews",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		responses: {
			200: {
				description: "The service's previews",
				isArray: true,
				schema: previewResponse,
			},
			401: error("Unauthorized"),
			404: error("Not found"),
		},
		summary: "List a service's previews",
		tags: ["Previews"],
	},
	{
		description:
			"One pull request's preview. What `homerun previews wait` polls: ready once revision.gitCommit is the commit under test and revision.health is healthy.",
		method: "get",
		path: "/services/{serviceId}/previews/{prNumber}",
		pathParams: servicePrParams,
		responses: {
			200: { description: "The preview", schema: previewResponse },
			400: error("Not a pull request number"),
			401: error("Unauthorized"),
			404: error("No such service, or no preview for that pull request"),
		},
		summary: "Get a preview",
		tags: ["Previews"],
	},
	{
		description:
			"Creates or updates the pull request's preview on an image-based service, from the image CI just pushed: a new preview gets the service's preview settings (env and overrides, domains, login wall, stack, volume copies when that's on) and runs the service's own image at tag, with its registry credentials; an existing one switches to tag and redeploys, without copying volumes again. commit is recorded on the preview's revision for homerun previews wait --commit. With branch, the preview branch filter applies: a filtered-out branch is refused and loses the preview it had. Returns once the deploy is queued.",
		method: "put",
		path: "/services/{serviceId}/previews/{prNumber}",
		pathParams: servicePrParams,
		requestBody: deployPreviewApiBody,
		responses: {
			202: {
				description: "Deploy queued",
				schema: deployPreviewResponse,
			},
			400: error(
				"Invalid body, not a pull request number, or the service builds from git (its previews come from the webhook) or is itself a preview",
			),
			401: error("Unauthorized"),
			404: error("Not found"),
			409: error(
				"Previews are off, the branch doesn't pass the preview branch filter, the preview's slug is taken, or the instance is out of capacity",
			),
		},
		summary: "Deploy a preview from an image",
		tags: ["Previews"],
	},
	{
		description:
			"Deletes the preview's workload, DNS records and row. A git service's next push to the pull request recreates it; an image-based service's CI calls this when the pull request closes.",
		method: "delete",
		path: "/services/{serviceId}/previews/{prNumber}",
		pathParams: servicePrParams,
		responses: {
			200: { description: "Deleted", schema: successResponse },
			400: error("Not a pull request number"),
			401: error("Unauthorized"),
			404: error("No such service, or no preview for that pull request"),
			409: error("The preview's workload couldn't be removed"),
		},
		summary: "Delete a preview",
		tags: ["Previews"],
	},
	{
		description:
			"Deploys the exact image the preview's current revision runs to the service it previews, without building, pulling or scanning, the same way a rollback redeploys a revision. An image-based service ends up on the preview's image and tag. The deployment points at the preview revision (rollbackOfDeploymentId) and its log opens with where the image came from. Refused while the preview has no running revision, while its health is still being watched or unhealthy, or when commit is given and isn't what it runs. Returns once queued: poll GET /jobs/{jobId}.",
		method: "post",
		path: "/services/{serviceId}/previews/{prNumber}/promote",
		pathParams: servicePrParams,
		requestBody: promotePreviewApiBody,
		requestBodyOptional: true,
		responses: {
			202: { description: "Deploy queued", schema: promoteResponse },
			400: error("Invalid body, or the service is itself a preview"),
			401: error("Unauthorized"),
			404: error("No such service, or no preview for that pull request"),
			409: error(
				"The preview has no running revision, isn't healthy, or runs another commit",
			),
		},
		summary: "Promote a preview",
		tags: ["Previews"],
	},
];
