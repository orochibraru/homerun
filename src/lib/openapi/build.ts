import { z } from "zod";
import { READ_ONLY_MESSAGE } from "#lib/permissions.js";
import { routes } from "./registry";

/** zod's toJSONSchema() emits a top-level `$schema` pointer meant for a standalone document : an embedded OpenAPI schema object shouldn't carry one. */
function toEmbeddedSchema(schema: z.ZodType): Record<string, unknown> {
	const { $schema: _unused, ...rest } = z.toJSONSchema(schema, {
		target: "draft-2020-12",
	}) as Record<string, unknown>;
	return rest;
}

const readOnlyForbidden = {
	content: {
		"application/json": {
			schema: {
				properties: {
					error: { example: READ_ONLY_MESSAGE, type: "string" },
				},
				required: ["error"],
				type: "object",
			},
		},
	},
	description:
		"Read-only caller: the user holds the read-only role or the request used a read-only API key.",
};

/** The responses every route of this method documents before its own: a write also answers 403 to a read-only caller. */
function baseResponses(method: string): Record<string, unknown> {
	return method === "get" ? {} : { 403: readOnlyForbidden };
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

		const responses = baseResponses(route.method);
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
						"An API key from Profile → Authorized Clients (or `homerun login`). A key is created with Full access or Read-only scope: a read-only key may call every GET endpoint and gets a 403 on anything that writes.",
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
