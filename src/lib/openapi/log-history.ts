import { z } from "zod";

import type { RouteDef } from "./registry";
import { errorResponse } from "./schemas";

const unauthorized = { description: "Unauthorized", schema: errorResponse };
const notFound = { description: "Not found", schema: errorResponse };

export const logHistoryResponse = z.object({
	lines: z
		.array(
			z.object({
				deploymentId: z.string().nullable().meta({
					description:
						"The deployment (revision) that was running when the line was written, null when it couldn't be told",
				}),
				id: z.number().int(),
				instance: z.string().meta({
					description:
						"The container (short id) or swarm task that wrote the line",
				}),
				line: z.string(),
				stream: z.enum(["stdout", "stderr"]).meta({
					description:
						"stdout for a TTY container, which every service Homerun deploys is, since a TTY has one stream",
				}),
				time: z.string().meta({
					description: "When the line was written, UTC, microseconds",
				}),
			}),
		)
		.meta({ description: "Newest first" }),
	nextCursor: z.string().nullable().meta({
		description:
			"Pass as before to read the page of older lines; null when this is the oldest",
	}),
});

export const logHistoryRoutes: RouteDef[] = [
	{
		description:
			"Searches the service's stored logs: every line its containers and swarm tasks wrote, across deploys, kept for the instance's log retention (Monitoring → Settings). Newest first, one page at a time.",
		method: "get",
		path: "/services/{serviceId}/logs/history",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		queryParams: [
			{
				description:
					"Only lines containing this text, case-insensitive (a POSIX regex with regex=true)",
				name: "q",
			},
			{ description: "true to read q as a regular expression", name: "regex" },
			{
				description: "Only lines written at or after this ISO 8601 time",
				name: "from",
			},
			{
				description: "Only lines written at or before this ISO 8601 time",
				name: "to",
			},
			{
				description:
					"Instead of from/to: 15m, 1h, 6h, 24h, 7d or all (default all)",
				name: "range",
			},
			{
				description: "Only lines written while this deployment was running",
				name: "deploymentId",
			},
			{
				description: "Only lines from this container (short id) or swarm task",
				name: "instance",
			},
			{ description: "stdout or stderr", name: "stream" },
			{ description: "Lines per page, 1 to 1000 (default 200)", name: "limit" },
			{
				description: "The nextCursor of the previous page, for older lines",
				name: "before",
			},
		],
		responses: {
			200: { description: "One page of lines", schema: logHistoryResponse },
			400: {
				description: "An invalid parameter or regular expression",
				schema: errorResponse,
			},
			401: unauthorized,
			404: notFound,
		},
		summary: "Search a service's log history",
		tags: ["Services"],
	},
];
