import { z } from "zod";
import { buildInputSchema, deployInputSchema } from "./schemas";
import { AGENT_VERSION } from "./version";

/** Strip the top-level `$schema` pointer zod's toJSONSchema() adds : not meaningful on a schema embedded inside a bigger OpenAPI document. */
function toEmbeddedSchema(schema: z.ZodType): Record<string, unknown> {
	const { $schema: _unused, ...rest } = z.toJSONSchema(schema, {
		target: "draft-2020-12",
	}) as Record<string, unknown>;
	return rest;
}

const errorSchema = z.object({
	error: z.string(),
	issues: z.unknown().optional(),
});
const okSchema = z.object({ ok: z.boolean() });
const statsSchema = z.object({
	cpuPercent: z.number(),
	diskPercent: z.number().nullable(),
	diskTotalMb: z.number().nullable(),
	diskUsedMb: z.number().nullable(),
	gpu: z
		.object({
			memTotalMb: z.number(),
			memUsedMb: z.number(),
			name: z.string(),
			utilizationPercent: z.number(),
		})
		.nullable(),
	memPercent: z.number(),
	memTotalMb: z.number(),
	memUsedMb: z.number(),
});
const containerStatusSchema = z.object({
	exitCode: z.number().nullable(),
	id: z.string(),
	state: z.string(),
	status: z.string(),
});
const deployResultSchema = z.object({
	containerId: z.string(),
	log: z.array(z.string()),
});
const buildResultSchema = z.object({
	error: z.string().optional(),
	success: z.boolean(),
});

/**
 * Same "one document, hand-registered routes" shape as the main app's
 * `$lib/openapi/build.ts` : kept as a sibling implementation rather than a
 * shared package since the agent has no access to the main app's source
 * tree at runtime (see agent/README.md). A class rather than a loose
 * function purely for consistency with every other agent/ module, even
 * though `buildDocument` itself is a pure transform (baseUrl in, doc out).
 */
class AgentOpenApiBuilder {
	// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one OpenAPI document literal, not branching logic
	buildDocument(baseUrl: string): Record<string, unknown> {
		const jsonResponse = (
			description: string,
			schema: z.ZodType,
			isArray = false,
		) => ({
			content: {
				"application/json": {
					schema: isArray
						? { items: toEmbeddedSchema(schema), type: "array" }
						: toEmbeddedSchema(schema),
				},
			},
			description,
		});

		return {
			components: {
				securitySchemes: {
					bearerAuth: {
						bearerFormat: "opaque token",
						scheme: "bearer",
						type: "http",
					},
				},
			},
			info: {
				description:
					"A single Homerun Agent's own HTTP control surface : deploy/start/stop/restart/logs/stats for the one Docker daemon this agent runs on. See agent/README.md.",
				title: "Homerun Agent API",
				version: AGENT_VERSION,
			},
			openapi: "3.1.0",
			paths: {
				"/v1/build": {
					post: {
						description:
							"Clones a git repo at a ref and builds its Dockerfile into a local image tagged `tag`, optionally pushing it to a registry afterward (see the request schema's own docstring for when that matters).",
						requestBody: {
							content: {
								"application/json": {
									schema: toEmbeddedSchema(buildInputSchema),
								},
							},
							required: true,
						},
						responses: {
							200: jsonResponse("Build succeeded", buildResultSchema),
							400: jsonResponse("Invalid request body", errorSchema),
							401: jsonResponse("Unauthorized", errorSchema),
							500: jsonResponse("Build failed", buildResultSchema),
						},
						security: [{ bearerAuth: [] }],
						summary: "Build an image from a git repo",
						tags: ["Deploy"],
					},
				},
				"/v1/containers": {
					get: {
						responses: {
							200: jsonResponse(
								"Managed containers on this host",
								z.unknown(),
								true,
							),
							401: jsonResponse("Unauthorized", errorSchema),
						},
						security: [{ bearerAuth: [] }],
						summary: "List managed containers",
						tags: ["Containers"],
					},
				},
				"/v1/containers/{id}": {
					delete: {
						parameters: [
							{
								in: "path",
								name: "id",
								required: true,
								schema: { type: "string" },
							},
						],
						responses: {
							200: jsonResponse("Removed", okSchema),
							401: jsonResponse("Unauthorized", errorSchema),
						},
						security: [{ bearerAuth: [] }],
						summary: "Stop and remove a container",
						tags: ["Containers"],
					},
					get: {
						parameters: [
							{
								in: "path",
								name: "id",
								required: true,
								schema: { type: "string" },
							},
						],
						responses: {
							200: jsonResponse("Status", containerStatusSchema),
							401: jsonResponse("Unauthorized", errorSchema),
						},
						security: [{ bearerAuth: [] }],
						summary: "Inspect a container's status",
						tags: ["Containers"],
					},
				},
				"/v1/containers/{id}/logs": {
					get: {
						parameters: [
							{
								in: "path",
								name: "id",
								required: true,
								schema: { type: "string" },
							},
							{
								in: "query",
								name: "follow",
								required: false,
								schema: { type: "boolean" },
							},
						],
						responses: {
							200: {
								content: {
									"application/octet-stream": {
										schema: { format: "binary", type: "string" },
									},
								},
								description: "Raw log bytes, streamed when follow=true",
							},
							401: jsonResponse("Unauthorized", errorSchema),
						},
						security: [{ bearerAuth: [] }],
						summary: "Fetch or follow a container's logs",
						tags: ["Containers"],
					},
				},
				"/v1/containers/{id}/restart": {
					post: {
						parameters: [
							{
								in: "path",
								name: "id",
								required: true,
								schema: { type: "string" },
							},
						],
						responses: {
							200: jsonResponse("Restarted", okSchema),
							401: jsonResponse("Unauthorized", errorSchema),
						},
						security: [{ bearerAuth: [] }],
						summary: "Restart a container",
						tags: ["Containers"],
					},
				},
				"/v1/containers/{id}/start": {
					post: {
						parameters: [
							{
								in: "path",
								name: "id",
								required: true,
								schema: { type: "string" },
							},
						],
						responses: {
							200: jsonResponse("Started", okSchema),
							401: jsonResponse("Unauthorized", errorSchema),
						},
						security: [{ bearerAuth: [] }],
						summary: "Start a container",
						tags: ["Containers"],
					},
				},
				"/v1/containers/{id}/stop": {
					post: {
						parameters: [
							{
								in: "path",
								name: "id",
								required: true,
								schema: { type: "string" },
							},
						],
						responses: {
							200: jsonResponse("Stopped", okSchema),
							401: jsonResponse("Unauthorized", errorSchema),
						},
						security: [{ bearerAuth: [] }],
						summary: "Stop a container",
						tags: ["Containers"],
					},
				},
				"/v1/deploy": {
					post: {
						description:
							"Pulls the image, removes the previous container for this serviceId (found by label), creates and starts the new one.",
						requestBody: {
							content: {
								"application/json": {
									schema: toEmbeddedSchema(deployInputSchema),
								},
							},
							required: true,
						},
						responses: {
							200: jsonResponse("Deployed", deployResultSchema),
							400: jsonResponse("Invalid request body", errorSchema),
							401: jsonResponse("Unauthorized", errorSchema),
							500: jsonResponse("Deploy failed", errorSchema),
						},
						security: [{ bearerAuth: [] }],
						summary: "Deploy a container",
						tags: ["Deploy"],
					},
				},
				"/v1/health": {
					get: {
						description:
							"Unauthenticated on purpose, for a load balancer/monitor probe.",
						responses: {
							200: jsonResponse(
								"OK",
								z.object({ status: z.string(), version: z.string() }),
							),
						},
						summary: "Health check",
						tags: ["Meta"],
					},
				},
				"/v1/stats": {
					get: {
						responses: {
							200: jsonResponse("Host CPU/RAM/disk/GPU stats", statsSchema),
							401: jsonResponse("Unauthorized", errorSchema),
						},
						security: [{ bearerAuth: [] }],
						summary: "Host resource stats",
						tags: ["Meta"],
					},
				},
			},
			servers: [{ url: baseUrl }],
		};
	}
}

export const OpenApiBuilder = new AgentOpenApiBuilder();
