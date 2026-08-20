import { z } from "zod";
import { routes } from "./registry";

/** zod's toJSONSchema() emits a top-level `$schema` pointer meant for a standalone document : an embedded OpenAPI schema object shouldn't carry one. */
function toEmbeddedSchema(schema: z.ZodType): Record<string, unknown> {
	const { $schema: _unused, ...rest } = z.toJSONSchema(schema, {
		target: "draft-2020-12",
	}) as Record<string, unknown>;
	return rest;
}

/**
 * Builds the OpenAPI 3.1 document served at GET /api/v1/openapi.json.
 * Request bodies come straight from the same zod schemas that validate the
 * request at runtime (`$lib/server/validation/api.ts`, via `registry.ts`) :
 * response shapes are hand-mirrored (see schemas.ts's docstring for why).
 */
export function buildOpenApiDocument(baseUrl: string): Record<string, unknown> {
	const paths: Record<string, Record<string, unknown>> = {};

	for (const route of routes) {
		paths[route.path] ??= {};

		const responses: Record<string, unknown> = {};
		for (const [status, def] of Object.entries(route.responses)) {
			responses[status] = {
				content: def.schema
					? {
							"application/json": {
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
			parameters: route.pathParams?.map((p) => ({
				description: p.description,
				in: "path",
				name: p.name,
				required: true,
				schema: { type: "string" },
			})),
			requestBody: route.requestBody
				? {
						content: {
							"application/json": {
								schema: toEmbeddedSchema(route.requestBody),
							},
						},
						required: true,
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
						"A better-auth API key, from the app's own Settings/API keys UI.",
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
				"Homerun's REST API : a thin JSON wrapper over the DTO layer, meant for a future CLI (see the `cli/` sub-project) and any other external client. Requests are the same zod schemas that validate them server-side; every route also requires a cookie session or an `x-api-key`/`Authorization: Bearer` API key (see hooks.server.ts).",
			title: "Homerun API",
			version: "1.0.0",
		},
		openapi: "3.1.0",
		paths,
		servers: [{ url: `${baseUrl}/api/v1` }],
	};
}
