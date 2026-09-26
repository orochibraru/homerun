import { z } from "zod";
import { releaseChannelsApiBody } from "$lib/server/validation/api";
import type { RouteDef } from "./registry";
import { errorResponse } from "./schemas";

export const releaseChannelsResponse = z.object({
	branch: z.string().nullable().meta({
		description: "The branch whose pushes deploy the canary",
	}),
	canary: z
		.object({
			gitRef: z.string().nullable(),
			hostname: z.string().nullable(),
			id: z.string(),
			name: z.string(),
			slug: z.string(),
			status: z.enum([
				"pending",
				"pulling",
				"starting",
				"running",
				"stopped",
				"failed",
				"missing",
			]),
		})
		.nullable()
		.meta({
			description:
				"The canary service Homerun manages, null while channels are off",
		}),
	canaryDomain: z.string().nullable(),
	enabled: z.boolean(),
	stableRef: z.string().nullable().meta({
		description:
			"The ref the stable service (this one) builds: the last tag deployed, or its branch until the first tag",
	}),
	tagPattern: z.string().meta({
		description: "Glob a pushed tag must match to deploy the stable service",
	}),
});

const serviceIdParam = [{ description: "Service id", name: "serviceId" }];

export const channelRoutes: RouteDef[] = [
	{
		description:
			"A git service's release channel settings: the canary branch, the tag pattern that deploys stable, and its canary service.",
		method: "get",
		path: "/services/{serviceId}/channels",
		pathParams: serviceIdParam,
		responses: {
			200: {
				description: "The release channel settings",
				schema: releaseChannelsResponse,
			},
			401: { description: "Unauthorized", schema: errorResponse },
			404: { description: "Service not found", schema: errorResponse },
		},
		summary: "Get a service's release channels",
		tags: ["Services"],
	},
	{
		description:
			"Turns release channels on or off, or changes their settings. On: pushes to the canary branch deploy a companion <slug>-canary service, and pushed tags matching the pattern deploy this service at that tag. Turning them on creates and deploys the canary; off deletes it. The webhook is re-registered to include tag pushes.",
		method: "patch",
		path: "/services/{serviceId}/channels",
		pathParams: serviceIdParam,
		requestBody: releaseChannelsApiBody,
		responses: {
			200: {
				description: "The updated settings",
				schema: releaseChannelsResponse,
			},
			400: {
				description:
					"Not a git service, a preview or canary itself, or an invalid setting",
				schema: errorResponse,
			},
			401: { description: "Unauthorized", schema: errorResponse },
			404: { description: "Service not found", schema: errorResponse },
		},
		summary: "Configure a service's release channels",
		tags: ["Services"],
	},
];
