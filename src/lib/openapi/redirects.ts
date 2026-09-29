import { z } from "zod";
import { redirectApiBody } from "$lib/server/validation/api";
import type { ParamDef, RouteDef } from "./registry";
import { errorResponse, successResponse } from "./schemas";

const timestamp = z.string().meta({ description: "ISO 8601 timestamp" });

const listParams: ParamDef[] = [
	{ description: "1-based page number (default 1)", name: "page" },
	{ description: "Items per page (default 100, max 200)", name: "perPage" },
	{ description: "Case-insensitive search term", name: "q" },
];

const redirectIdParam: ParamDef[] = [
	{ description: "Redirect id", name: "redirectId" },
];

export const redirectResponse = z.object({
	createdAt: timestamp,
	destination: z.string(),
	enabled: z.boolean(),
	id: z.string(),
	keepPath: z.boolean(),
	permanent: z.boolean(),
	source: z.string().meta({
		description: "Lowercase hostname plus an optional path prefix",
	}),
	updatedAt: timestamp,
	userId: z.string(),
});

const unauthorized = { description: "Unauthorized", schema: errorResponse };
const notFound = { description: "Not found", schema: errorResponse };
const invalid = {
	description: "Invalid body, or the source already has a redirect",
	schema: errorResponse,
};

export const redirectRoutes: RouteDef[] = [
	{
		description:
			"Every redirect, newest first. Paginated: the body is the page, x-total-count, x-page and x-per-page carry the rest.",
		method: "get",
		path: "/redirects",
		queryParams: listParams,
		responses: {
			200: {
				description: "One page of redirects",
				isArray: true,
				schema: redirectResponse,
			},
			401: unauthorized,
		},
		summary: "List redirects",
		tags: ["Redirects"],
	},
	{
		description:
			"Adds a redirect and publishes it to Traefik and the DNS automation. source and destination are required; enabled, keepPath and permanent default to true, like the dashboard form.",
		method: "post",
		path: "/redirects",
		requestBody: redirectApiBody,
		responses: {
			201: { description: "Created", schema: redirectResponse },
			400: invalid,
			401: unauthorized,
		},
		summary: "Create a redirect",
		tags: ["Redirects"],
	},
	{
		method: "get",
		path: "/redirects/{redirectId}",
		pathParams: redirectIdParam,
		responses: {
			200: { description: "The redirect", schema: redirectResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Get a redirect",
		tags: ["Redirects"],
	},
	{
		description:
			'Changes the fields sent, keeping the rest, and republishes. Send {"enabled": false} to turn one off.',
		method: "patch",
		path: "/redirects/{redirectId}",
		pathParams: redirectIdParam,
		requestBody: redirectApiBody,
		responses: {
			200: { description: "Updated", schema: redirectResponse },
			400: invalid,
			401: unauthorized,
			404: notFound,
		},
		summary: "Update a redirect",
		tags: ["Redirects"],
	},
	{
		method: "delete",
		path: "/redirects/{redirectId}",
		pathParams: redirectIdParam,
		responses: {
			200: { description: "Deleted", schema: successResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Delete a redirect",
		tags: ["Redirects"],
	},
];
