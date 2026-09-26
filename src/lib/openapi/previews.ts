import { z } from "zod";
import { promotePreviewApiBody } from "$lib/server/validation/api";
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
			"What the preview builds: the pull request's head SHA, or its branch when the provider sent no full SHA",
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
			"Deletes the preview's workload, DNS records and row. The next push to the pull request recreates it.",
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
			"Deploys the exact image the preview's current revision runs to the service it previews, without building, pulling or scanning, the same way a rollback redeploys a revision. The deployment points at the preview revision (rollbackOfDeploymentId) and its log opens with where the image came from. Refused while the preview has no running revision, while its health is still being watched or unhealthy, or when commit is given and isn't what it runs. Returns once queued: poll GET /jobs/{jobId}.",
		method: "post",
		path: "/services/{serviceId}/previews/{prNumber}/promote",
		pathParams: servicePrParams,
		requestBody: promotePreviewApiBody,
		requestBodyOptional: true,
		responses: {
			202: { description: "Deploy queued", schema: promoteResponse },
			400: error("Invalid body, or the service doesn't build from git"),
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
