import { z } from "zod";
import { serviceDependenciesApiBody } from "$lib/server/validation/api";
import type { RouteDef } from "./registry";
import { errorResponse } from "./schemas";

const dependencyRef = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	source: z.enum(["recorded", "env", "both"]).meta({
		description:
			"recorded: a stored dependency, the only kind that orders starts; env: one of the depending service's env values points at the other's slug as a host; both: the two at once",
	}),
});

export const serviceDependenciesResponse = z.object({
	dependedOnBy: z.array(dependencyRef).meta({
		description: "The services that depend on this one",
	}),
	dependsOn: z.array(dependencyRef).meta({
		description: "The services this one depends on",
	}),
});

const serviceIdParam = [{ description: "Service id", name: "serviceId" }];

export const dependencyRoutes: RouteDef[] = [
	{
		description:
			"What a service depends on and what depends on it, both recorded dependencies (which set start order) and env links (an env value naming the other service's slug as a host).",
		method: "get",
		path: "/services/{serviceId}/dependencies",
		pathParams: serviceIdParam,
		responses: {
			200: {
				description: "The service's dependencies, both directions",
				schema: serviceDependenciesResponse,
			},
			401: { description: "Unauthorized", schema: errorResponse },
			404: { description: "Service not found", schema: errorResponse },
		},
		summary: "List a service's dependencies",
		tags: ["Services"],
	},
	{
		description:
			"Replaces the services this one is recorded as depending on: they're started before it, and a stack deploy queues them first. Env vars aren't touched, so an env link to a service left out still shows as an env dependency.",
		method: "put",
		path: "/services/{serviceId}/dependencies",
		pathParams: serviceIdParam,
		requestBody: serviceDependenciesApiBody,
		responses: {
			200: {
				description: "The service's dependencies after the change",
				schema: serviceDependenciesResponse,
			},
			400: {
				description:
					"An invalid body, an unknown service id, the service itself, or a service that already depends on this one (a loop)",
				schema: errorResponse,
			},
			401: { description: "Unauthorized", schema: errorResponse },
			404: { description: "Service not found", schema: errorResponse },
		},
		summary: "Set a service's dependencies",
		tags: ["Services"],
	},
];
