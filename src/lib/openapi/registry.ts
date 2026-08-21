import type { z } from "zod";
import {
	createProjectApiBody,
	createServiceApiBody,
	updateServiceApiBody,
} from "$lib/server/validation/api";
import {
	deployResultResponse,
	errorResponse,
	projectResponse,
	serviceResponse,
	successResponse,
	systemStatsResponse,
	templateResponse,
} from "./schemas";

export interface ResponseDef {
	description: string;
	schema?: z.ZodType;
	isArray?: boolean;
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
	requestBody?: z.ZodType;
	responses: Record<number, ResponseDef>;
}

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
		method: "get",
		path: "/services",
		responses: {
			200: {
				description: "The caller's services",
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
			"Stops/removes the container first, same as the Settings danger-zone action.",
		method: "delete",
		path: "/services/{serviceId}",
		pathParams: [{ description: "Service id", name: "serviceId" }],
		responses: {
			204: { description: "Deleted" },
			401: unauthorized,
			404: notFound,
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
		method: "get",
		path: "/projects",
		responses: {
			200: {
				description: "The caller's projects",
				isArray: true,
				schema: projectResponse,
			},
			401: unauthorized,
		},
		summary: "List projects",
		tags: ["Projects"],
	},
	{
		method: "post",
		path: "/projects",
		requestBody: createProjectApiBody,
		responses: {
			201: { description: "Created", schema: projectResponse },
			400: badRequest,
			401: unauthorized,
			409: { description: "Slug already in use", schema: errorResponse },
		},
		summary: "Create a project",
		tags: ["Projects"],
	},
	{
		method: "get",
		path: "/templates",
		responses: {
			200: {
				description: "Built-in templates plus the caller's own",
				isArray: true,
				schema: templateResponse,
			},
			401: unauthorized,
		},
		summary: "List templates usable by the caller",
		tags: ["Templates"],
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
];
