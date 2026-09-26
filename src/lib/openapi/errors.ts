import { z } from "zod";
import { errorIssueStatusApiBody } from "$lib/server/validation/api";
import type { RouteDef } from "./registry";
import { errorResponse } from "./schemas";

const timestamp = z.string().meta({ description: "ISO 8601 timestamp" });

export const errorIssueResponse = z.object({
	count: z.number().int().meta({ description: "Events received, all time" }),
	culprit: z.string().nullable().meta({
		description:
			"The innermost in-app frame, function (file), or the transaction",
	}),
	fingerprint: z.string().meta({ description: "The grouping hash" }),
	firstRelease: z.string().nullable(),
	firstSeen: timestamp,
	id: z.string(),
	lastEnvironment: z.string().nullable(),
	lastRelease: z.string().nullable(),
	lastSeen: timestamp,
	level: z.enum(["fatal", "error", "warning", "info", "debug"]),
	platform: z.string().nullable(),
	regressedAt: timestamp.nullable().meta({
		description: "When a resolved issue last happened again",
	}),
	resolvedAt: timestamp.nullable(),
	serviceId: z.string(),
	status: z.enum(["unresolved", "resolved", "ignored"]),
	title: z.string(),
	type: z.string().nullable(),
	value: z.string().nullable(),
});

const errorIssueListItem = errorIssueResponse.extend({
	usersAffected: z.number().int().meta({
		description: "Distinct users named by the retained events",
	}),
});

const frame = z.object({
	absPath: z.string().nullable(),
	colno: z.number().int().nullable(),
	contextLine: z.string().nullable(),
	filename: z.string().nullable(),
	function: z.string().nullable(),
	inApp: z.boolean(),
	lineno: z.number().int().nullable(),
	module: z.string().nullable(),
	postContext: z.array(z.string()),
	preContext: z.array(z.string()),
});

const errorEventResponse = z.object({
	breadcrumbs: z.array(
		z.object({
			category: z.string().nullable(),
			level: z.string().nullable(),
			message: z.string().nullable(),
			timestamp: z.string().nullable(),
			type: z.string().nullable(),
		}),
	),
	contexts: z.record(z.string(), z.record(z.string(), z.unknown())),
	culprit: z.string().nullable(),
	environment: z.string().nullable(),
	eventId: z.string().meta({ description: "The SDK's event id" }),
	exceptions: z
		.array(
			z.object({
				frames: z.array(frame).meta({
					description: "Oldest call first, the raising frame last",
				}),
				handled: z.boolean().nullable(),
				mechanism: z.string().nullable(),
				module: z.string().nullable(),
				type: z.string().nullable(),
				value: z.string().nullable(),
			}),
		)
		.meta({ description: "The exception chain, the raised one last" }),
	fingerprint: z.array(z.string()).nullable(),
	id: z.string(),
	level: z.string(),
	message: z.string().nullable(),
	newerEventId: z.string().nullable(),
	olderEventId: z.string().nullable(),
	platform: z.string().nullable(),
	receivedAt: timestamp,
	release: z.string().nullable(),
	request: z
		.object({ method: z.string().nullable(), url: z.string().nullable() })
		.nullable(),
	sdk: z.string().nullable(),
	serverName: z.string().nullable(),
	sourceLinks: z.record(z.string(), z.string()).meta({
		description:
			"Repository links of in-app frames at the deployed commit, keyed <exception index>:<frame index>",
	}),
	tags: z.array(z.tuple([z.string(), z.string()])),
	timestamp,
	title: z.string(),
	transaction: z.string().nullable(),
	user: z
		.object({
			email: z.string().nullable(),
			id: z.string().nullable(),
			ipAddress: z.string().nullable(),
			username: z.string().nullable(),
		})
		.nullable(),
});

export const errorIssueDetailResponse = errorIssueResponse.extend({
	event: errorEventResponse.nullable().meta({
		description:
			"The requested event, the newest by default; null once none is retained",
	}),
	eventsRetained: z.number().int(),
	usersAffected: z.number().int(),
});

const serviceIdParam = { description: "Service id", name: "serviceId" };
const issueParams = [
	serviceIdParam,
	{ description: "Issue id", name: "issueId" },
];

export const errorRoutes: RouteDef[] = [
	{
		description:
			"A service's error issues, most recently seen first. Paginated like the other lists: the body is the page, x-total-count, x-page and x-per-page carry the rest.",
		method: "get",
		path: "/services/{serviceId}/errors",
		pathParams: [serviceIdParam],
		queryParams: [
			{
				description:
					"unresolved (default), resolved, ignored or all; comma-separated for several",
				name: "status",
			},
			{
				description:
					"lastSeen, firstSeen or count, with a leading - for descending",
				name: "sort",
			},
			{ description: "1-based page number (default 1)", name: "page" },
			{ description: "Items per page (default 100, max 200)", name: "perPage" },
			{ description: "Search title and culprit", name: "q" },
		],
		responses: {
			200: {
				description: "One page of issues",
				isArray: true,
				schema: errorIssueListItem,
			},
			401: { description: "Unauthorized", schema: errorResponse },
			404: { description: "Service not found", schema: errorResponse },
		},
		summary: "List a service's error issues",
		tags: ["Errors"],
	},
	{
		description:
			"One issue with one of its events: the newest, or the one `event` names. The event carries the exception chain, stack frames with source context, breadcrumbs, tags, request and user, plus repository links for in-app frames of git services.",
		method: "get",
		path: "/services/{serviceId}/errors/{issueId}",
		pathParams: issueParams,
		queryParams: [{ description: "An event id of this issue", name: "event" }],
		responses: {
			200: { description: "The issue", schema: errorIssueDetailResponse },
			401: { description: "Unauthorized", schema: errorResponse },
			404: { description: "Service or issue not found", schema: errorResponse },
		},
		summary: "Get an error issue and its latest event",
		tags: ["Errors"],
	},
	{
		description:
			"Resolve, ignore or reopen an issue. A resolved issue that happens again reopens as a regression and notifies.",
		method: "patch",
		path: "/services/{serviceId}/errors/{issueId}",
		pathParams: issueParams,
		requestBody: errorIssueStatusApiBody,
		responses: {
			200: { description: "The updated issue", schema: errorIssueResponse },
			400: { description: "Invalid request body", schema: errorResponse },
			401: { description: "Unauthorized", schema: errorResponse },
			404: { description: "Service or issue not found", schema: errorResponse },
		},
		summary: "Change an error issue's status",
		tags: ["Errors"],
	},
];
