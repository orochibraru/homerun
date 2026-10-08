import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
	type ApiCall,
	asResult,
	change,
	read,
} from "#lib/server/mcp-tool-kit.js";

/** Registers the tools that list, create, change and delete redirects. */
export function registerRedirectTools(server: McpServer, api: ApiCall): void {
	const redirectId = z
		.string()
		.describe("The redirect's id, from list_redirects");
	const fields = {
		destination: z
			.string()
			.describe("The full http(s) URL to send requests to"),
		enabled: z.boolean().describe("Whether Traefik serves it"),
		keepPath: z
			.boolean()
			.describe(
				"Append the rest of the path and the query string to the destination",
			),
		permanent: z
			.boolean()
			.describe("A permanent (308) rather than temporary (307) redirect"),
		source: z
			.string()
			.describe(
				'A hostname with an optional path prefix, e.g. "old.example.com" or "example.com/blog"',
			),
	};
	const path = (id: string) => `/redirects/${encodeURIComponent(id)}`;

	server.registerTool(
		"list_redirects",
		{
			annotations: read,
			description:
				"List redirects: source, destination, whether they're on, permanent and keep the path.",
		},
		async () => asResult(await api("GET", "/redirects?perPage=100")),
	);

	server.registerTool(
		"create_redirect",
		{
			annotations: change,
			description:
				"Add a redirect. enabled, keepPath and permanent default to true.",
			inputSchema: z.object({
				destination: fields.destination,
				enabled: fields.enabled.optional(),
				keepPath: fields.keepPath.optional(),
				permanent: fields.permanent.optional(),
				source: fields.source,
			}),
		},
		async (input) => asResult(await api("POST", "/redirects", input)),
	);

	server.registerTool(
		"update_redirect",
		{
			annotations: change,
			description:
				"Change a redirect's fields, keeping the ones left out. enabled: false turns it off.",
			inputSchema: z.object({
				destination: fields.destination.optional(),
				enabled: fields.enabled.optional(),
				keepPath: fields.keepPath.optional(),
				permanent: fields.permanent.optional(),
				redirectId,
				source: fields.source.optional(),
			}),
		},
		async ({ redirectId: id, ...changes }) =>
			asResult(await api("PATCH", path(id), changes)),
	);

	server.registerTool(
		"delete_redirect",
		{
			annotations: { destructiveHint: true, openWorldHint: false },
			description: "Delete a redirect.",
			inputSchema: z.object({ redirectId }),
		},
		async ({ redirectId: id }) => asResult(await api("DELETE", path(id))),
	);
}
