import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
	type ApiCall,
	asResult,
	change,
	read,
} from "#lib/server/mcp-tool-kit.js";

/** Registers the object storage (S3) tools: the stores, and their buckets' lifecycle and public access. */
export function registerObjectStorageTools(
	server: McpServer,
	api: ApiCall,
): void {
	const storeId = z
		.string()
		.describe("The store's id, from list_object_stores");
	const bucket = z.string().describe("The bucket's name, from list_buckets");
	const expirationDays = z
		.number()
		.int()
		.min(1)
		.max(36_500)
		.nullable()
		.describe(
			"Delete objects this many days after they're written, null never",
		);
	const isPublic = z
		.boolean()
		.describe(
			"Serve the bucket's objects to anyone at /public/<storeId>/<bucket>/<key>, without signing in",
		);
	const bucketsPath = (id: string) =>
		`/object-stores/${encodeURIComponent(id)}/buckets`;
	const bucketPath = (id: string, name: string) =>
		`${bucketsPath(id)}/${encodeURIComponent(name)}`;

	server.registerTool(
		"list_object_stores",
		{
			annotations: read,
			description:
				"List the object stores: the built-in one and each S3-compatible provider, with endpoint, region and kind. Secrets are never returned.",
		},
		async () => asResult(await api("GET", "/object-stores")),
	);

	server.registerTool(
		"list_buckets",
		{
			annotations: read,
			description:
				"List a store's buckets, each with its expiry in days and whether it's public.",
			inputSchema: z.object({ storeId }),
		},
		async ({ storeId: id }) => asResult(await api("GET", bucketsPath(id))),
	);

	server.registerTool(
		"get_bucket",
		{
			annotations: read,
			description: "One bucket: its expiry in days and whether it's public.",
			inputSchema: z.object({ bucket, storeId }),
		},
		async ({ bucket: name, storeId: id }) =>
			asResult(await api("GET", bucketPath(id, name))),
	);

	server.registerTool(
		"create_bucket",
		{
			annotations: change,
			description:
				"Create a bucket on a store: 3 to 63 lowercase letters, digits, dots or dashes. Private and never expiring unless asked.",
			inputSchema: z.object({
				expirationDays: expirationDays.optional(),
				name: z.string().describe("The new bucket's name"),
				public: isPublic.optional(),
				storeId,
			}),
		},
		async ({ storeId: id, ...body }) =>
			asResult(await api("POST", bucketsPath(id), body)),
	);

	server.registerTool(
		"update_bucket",
		{
			annotations: change,
			description:
				"Change a bucket's expiry or public access, keeping what's left out.",
			inputSchema: z.object({
				bucket,
				expirationDays: expirationDays.optional(),
				public: isPublic.optional(),
				storeId,
			}),
		},
		async ({ bucket: name, storeId: id, ...changes }) =>
			asResult(await api("PATCH", bucketPath(id, name), changes)),
	);

	server.registerTool(
		"delete_bucket",
		{
			annotations: { destructiveHint: true, openWorldHint: false },
			description:
				"Delete an empty bucket. A bucket still holding objects is refused.",
			inputSchema: z.object({ bucket, storeId }),
		},
		async ({ bucket: name, storeId: id }) =>
			asResult(await api("DELETE", bucketPath(id, name))),
	);
}
