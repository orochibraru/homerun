import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
	type ApiCall,
	asResult,
	change,
	read,
} from "#lib/server/mcp-tool-kit.js";

const domainId = z
	.string()
	.describe("The mail domain's id, from list_mail_domains");
const mailboxId = z.string().describe("The mailbox's id, from list_mailboxes");
const aliasId = z.string().describe("The alias's id, from list_mail_aliases");
const mailboxFields = {
	displayName: z
		.string()
		.nullable()
		.optional()
		.describe("The name shown beside the address"),
	enabled: z
		.boolean()
		.optional()
		.describe("Whether it can sign in and receive mail"),
	ownerId: z
		.string()
		.nullable()
		.optional()
		.describe(
			"The Homerun user who owns it and can change its password themselves, from list_users",
		),
	quotaMb: z
		.number()
		.int()
		.positive()
		.nullable()
		.optional()
		.describe("Storage limit in MB, null for none"),
};
const destinations = z
	.array(z.string())
	.min(1)
	.describe("The addresses mail to it is forwarded to");

/** The API path of one mail domain, mailbox or alias. */
function itemPath(collection: string, id: string): string {
	return `/mail/${collection}/${encodeURIComponent(id)}`;
}

/** Registers the tools that list, read and add mail domains. */
function registerMailDomainTools(server: McpServer, api: ApiCall): void {
	server.registerTool(
		"list_mail_domains",
		{
			annotations: read,
			description:
				"The mail server's domains with their DKIM selector and public key.",
		},
		async () => asResult(await api("GET", "/mail/domains")),
	);

	server.registerTool(
		"get_mail_domain",
		{
			annotations: read,
			description:
				"One mail domain with each DNS record it needs (MX, SPF, DKIM, DMARC, the mail host's address) and what public resolvers answer for it now.",
			inputSchema: z.object({ domainId }),
		},
		async ({ domainId: id }) =>
			asResult(await api("GET", itemPath("domains", id))),
	);

	server.registerTool(
		"create_mail_domain",
		{
			annotations: change,
			description:
				"Make one of the DNS page's domains a mail domain, with a new DKIM key and a postmaster@ alias to the caller.",
			inputSchema: z.object({
				dnsDomainId: z
					.string()
					.describe("The DNS page domain's id, from list_domains"),
			}),
		},
		async (input) => asResult(await api("POST", "/mail/domains", input)),
	);
}

/** Registers the tools over mailboxes and noreply addresses. Deleting one wipes its mail, so it isn't a tool. */
function registerMailboxTools(server: McpServer, api: ApiCall): void {
	server.registerTool(
		"list_mailboxes",
		{
			annotations: read,
			description:
				"Every mailbox and noreply address: address, kind (mailbox people read, or noreply: send only, for apps), owner, quota and whether it's enabled.",
		},
		async () => asResult(await api("GET", "/mail/mailboxes")),
	);

	server.registerTool(
		"get_mailbox",
		{
			annotations: read,
			description: "One mailbox or noreply address.",
			inputSchema: z.object({ mailboxId }),
		},
		async ({ mailboxId: id }) =>
			asResult(await api("GET", itemPath("mailboxes", id))),
	);

	server.registerTool(
		"create_mailbox",
		{
			annotations: change,
			description:
				"Add a mailbox, or with kind noreply a send-only address apps sign in to SMTP with (incoming mail refused). enabled defaults to true.",
			inputSchema: z.object({
				...mailboxFields,
				domainId,
				kind: z.enum(["mailbox", "noreply"]).optional(),
				localPart: z.string().describe("The part before the @"),
				password: z
					.string()
					.describe("Its sign-in password, at least 10 characters"),
			}),
		},
		async (input) => asResult(await api("POST", "/mail/mailboxes", input)),
	);

	server.registerTool(
		"update_mailbox",
		{
			annotations: change,
			description:
				"Change a mailbox's fields, keeping the ones left out; password sets a new one.",
			inputSchema: z.object({
				...mailboxFields,
				mailboxId,
				password: z.string().optional().describe("A new sign-in password"),
			}),
		},
		async ({ mailboxId: id, ...changes }) =>
			asResult(await api("PATCH", itemPath("mailboxes", id), changes)),
	);
}

/** Registers the tools over mail aliases. */
function registerMailAliasTools(server: McpServer, api: ApiCall): void {
	server.registerTool(
		"list_mail_aliases",
		{
			annotations: read,
			description:
				"Every alias: the address, where it forwards to and whether it's on. @domain is a catch-all.",
		},
		async () => asResult(await api("GET", "/mail/aliases")),
	);

	server.registerTool(
		"create_mail_alias",
		{
			annotations: change,
			description:
				"Add an address forwarding to others; an empty localPart makes it the domain's catch-all.",
			inputSchema: z.object({
				destinations,
				domainId,
				enabled: z.boolean().optional(),
				localPart: z.string().describe("The part before the @"),
			}),
		},
		async (input) => asResult(await api("POST", "/mail/aliases", input)),
	);

	server.registerTool(
		"update_mail_alias",
		{
			annotations: change,
			description:
				"Change an alias's destinations or whether it's on, keeping what's left out.",
			inputSchema: z.object({
				aliasId,
				destinations: destinations.optional(),
				enabled: z.boolean().optional(),
			}),
		},
		async ({ aliasId: id, ...changes }) =>
			asResult(await api("PATCH", itemPath("aliases", id), changes)),
	);

	server.registerTool(
		"delete_mail_alias",
		{
			annotations: { destructiveHint: true, openWorldHint: false },
			description:
				"Delete an alias. Mailboxes it forwarded to keep their mail.",
			inputSchema: z.object({ aliasId }),
		},
		async ({ aliasId: id }) =>
			asResult(await api("DELETE", itemPath("aliases", id))),
	);
}

/**
 * Registers the mail server's tools: its domains, mailboxes (noreply
 * addresses included) and aliases. Deleting a domain or a mailbox wipes its
 * mail, so those stay on the dashboard, the API and the CLI.
 */
export function registerMailTools(server: McpServer, api: ApiCall): void {
	registerMailDomainTools(server, api);
	registerMailboxTools(server, api);
	registerMailAliasTools(server, api);
}
