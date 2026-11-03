import { z } from "zod";

import { SERVICE_EVENT_LANES } from "#lib/service-events.js";

import type { RouteDef } from "./registry";
import { errorResponse } from "./schemas";

const isoTimestamp = z.string().meta({
	description: "ISO 8601 timestamp",
	example: "2026-08-20T12:00:00.000Z",
});

export const serviceEventResponse = z.object({
	actorName: z.string().nullable().meta({
		description:
			"Who made the change, null for Homerun itself (a schedule, scale to zero, a backfill)",
	}),
	createdAt: isoTimestamp,
	detail: z.array(z.string()).meta({
		description:
			"One line per changed setting, old → new for plain values; secrets and env values only by name",
	}),
	id: z.string(),
	kind: z.string().meta({
		description:
			"What happened: created, settings, env, dependencies, scale, start, stop, restart, kill, mount, unmount, swap or restore",
	}),
	lane: z.enum(SERVICE_EVENT_LANES).meta({
		description: "The Activity lane it sits on on the service's Overview",
	}),
	summary: z.string(),
});

export const serviceEventRoutes: RouteDef[] = [
	{
		description:
			"What was changed on the service, newest first: settings, environment variables (by name only), domains and ports, volume mounts, dependencies, and starts, stops, restarts and scaling, each with who did it. Deploys aren't listed here, see /deployments.",
		method: "get",
		path: "/services/{serviceId}/events",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		queryParams: [
			{
				description: "How many events to return, 1 to 100 (default 50)",
				name: "limit",
			},
		],
		responses: {
			200: {
				description: "The service's events",
				isArray: true,
				schema: serviceEventResponse,
			},
			400: { description: "An invalid limit", schema: errorResponse },
			401: { description: "Unauthorized", schema: errorResponse },
			404: { description: "Not found", schema: errorResponse },
		},
		summary: "List a service's activity",
		tags: ["Services"],
	},
];
