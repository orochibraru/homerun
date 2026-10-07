import { z } from "zod";
import { permissionDeniedMessage } from "#lib/permissions.js";
import { routes } from "./registry";

/** zod's toJSONSchema() emits a top-level `$schema` pointer meant for a standalone document : an embedded OpenAPI schema object shouldn't carry one. */
function toEmbeddedSchema(schema: z.ZodType): Record<string, unknown> {
	const { $schema: _unused, ...rest } = z.toJSONSchema(schema, {
		target: "draft-2020-12",
	}) as Record<string, unknown>;
	return rest;
}

const permissionForbidden = {
	content: {
		"application/json": {
			schema: {
				properties: {
					error: {
						example: permissionDeniedMessage("services", "write"),
						type: "string",
					},
				},
				required: ["error"],
				type: "object",
			},
		},
	},
	description:
		"The caller's permissions, narrowed by the API key's when one is used, don't cover this area: reads need read access, writes need write access.",
};

/** The responses every route documents before its own: a 403 when the caller lacks the permission the route's area needs. */
function baseResponses(): Record<string, unknown> {
	return { 403: permissionForbidden };
}

/**
 * Builds the OpenAPI 3.1 document served at GET /api/v1/openapi.json.
 * Request bodies come straight from the same zod schemas that validate the
 * request at runtime (`#lib/server/validation/api.ts`, via `registry.ts`) :
 * response shapes are hand-mirrored (see schemas.ts's docstring for why).
 */
export function buildOpenApiDocument(baseUrl: string): Record<string, unknown> {
	const paths: Record<string, Record<string, unknown>> = {};

	for (const route of routes) {
		paths[route.path] ??= {};

		const responses = baseResponses();
		for (const [status, def] of Object.entries(route.responses)) {
			responses[status] = {
				content: def.schema
					? {
							[def.contentType ?? "application/json"]: {
								schema: def.isArray
									? { items: toEmbeddedSchema(def.schema), type: "array" }
									: toEmbeddedSchema(def.schema),
							},
						}
					: undefined,
				description: def.description,
			};
		}

		paths[route.path][route.method] = {
			description: route.description,
			operationId: `${route.method}${route.path.replace(/[/{}-]/g, "_")}`,
			parameters: [
				...(route.pathParams ?? []).map((p) => ({
					description: p.description,
					in: "path",
					name: p.name,
					required: true,
					schema: { type: "string" },
				})),
				...(route.queryParams ?? []).map((p) => ({
					description: p.description,
					in: "query",
					name: p.name,
					required: false,
					schema: { type: "string" },
				})),
			],
			requestBody: route.requestBody
				? {
						content: {
							[route.requestContentType ?? "application/json"]: {
								schema: toEmbeddedSchema(route.requestBody),
							},
						},
						required: !route.requestBodyOptional,
					}
				: undefined,
			responses,
			security: [{ apiKey: [] }, { bearerAuth: [] }],
			summary: route.summary,
			tags: route.tags,
		};
	}

	return {
		components: {
			securitySchemes: {
				apiKey: {
					description:
						"An API key from Profile → Authorized Clients (or `homerun login`). A key holds the permissions picked when it was created (read or write, per area), never more than its owner's, and may expire.",
					in: "header",
					name: "x-api-key",
					type: "apiKey",
				},
				bearerAuth: {
					bearerFormat: "API key",
					scheme: "bearer",
					type: "http",
				},
			},
		},
		info: {
			description:
				"Homerun's REST API, used by the `homerun` CLI, CI pipelines and any other client. Request bodies are validated against the schemas described here; every route requires a signed-in session or an API key, sent as `x-api-key` or `Authorization: Bearer`. Writes (POST, PATCH, DELETE) answer 403 for a read-only caller: a user holding the read-only role, or any request authenticated with a read-only API key.",
			title: "Homerun API",
			version: "1.0.0",
		},
		openapi: "3.1.0",
		paths,
		servers: [{ url: `${baseUrl}/api/v1` }],
	};
}
