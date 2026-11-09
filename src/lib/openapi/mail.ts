import { z } from "zod";

import {
	mailAliasCreateApiBody,
	mailAliasUpdateApiBody,
	mailDomainApiBody,
	mailMailboxCreateApiBody,
	mailMailboxUpdateApiBody,
} from "#lib/server/validation/mail-api.js";

import type { ParamDef, RouteDef } from "./registry";
import { errorResponse } from "./schemas";

const timestamp = z.string().meta({ description: "ISO 8601 timestamp" });

export const mailDomainResponse = z.object({
	createdAt: timestamp,
	dkimPublicKey: z.string().meta({
		description:
			"The DKIM public key, base64 SPKI. The private key is never returned.",
	}),
	dkimSelector: z.string(),
	id: z.string(),
	name: z.string(),
	updatedAt: timestamp,
	userId: z.string().nullable(),
});

const mailRecordCheck = z.object({
	found: z.array(z.string()).meta({
		description: "What public resolvers answer for the record's name and type",
	}),
	record: z.object({
		content: z.string(),
		name: z.string(),
		priority: z.number().int().nullable(),
		purpose: z.string(),
		type: z.enum(["A", "MX", "TXT"]),
	}),
	state: z.enum(["ok", "different", "missing"]),
});

export const mailMailboxResponse = z.object({
	address: z.string(),
	createdAt: timestamp,
	displayName: z.string().nullable(),
	domain: z.string(),
	domainId: z.string(),
	enabled: z.boolean(),
	id: z.string(),
	kind: z.enum(["mailbox", "noreply"]).meta({
		description:
			"mailbox: an inbox people read. noreply: send only, incoming mail is refused.",
	}),
	localPart: z.string(),
	ownerId: z.string().nullable(),
	quotaMb: z.number().int().nullable(),
	updatedAt: timestamp,
});

export const mailAliasResponse = z.object({
	address: z.string().meta({ description: "@domain for a catch-all" }),
	createdAt: timestamp,
	destinations: z.array(z.string()),
	domain: z.string(),
	domainId: z.string(),
	enabled: z.boolean(),
	id: z.string(),
	localPart: z.string(),
	updatedAt: timestamp,
});

const unauthorized = { description: "Unauthorized", schema: errorResponse };
const notFound = { description: "Not found", schema: errorResponse };
const refused = {
	description: "Invalid body, or the server refused it",
	schema: errorResponse,
};
const deleted = { description: "Deleted, the mail server is being updated" };
const tags = ["Mail"];

const domainIdParam: ParamDef[] = [
	{ description: "Mail domain id", name: "domainId" },
];
const mailboxIdParam: ParamDef[] = [
	{ description: "Mailbox id", name: "mailboxId" },
];
const aliasIdParam: ParamDef[] = [{ description: "Alias id", name: "aliasId" }];

const sync =
	"The mail server picks the change up from a background job queued here.";

export const mailRoutes: RouteDef[] = [
	{
		method: "get",
		path: "/mail/domains",
		responses: {
			200: {
				description: "Every mail domain, alphabetically",
				isArray: true,
				schema: mailDomainResponse,
			},
			401: unauthorized,
		},
		summary: "List mail domains",
		tags,
	},
	{
		description: `Adds one of the DNS page's domains as a mail domain, with a fresh DKIM key and a postmaster@ alias forwarding to the caller's email. ${sync}`,
		method: "post",
		path: "/mail/domains",
		requestBody: mailDomainApiBody,
		responses: {
			201: { description: "Created", schema: mailDomainResponse },
			400: refused,
			401: unauthorized,
		},
		summary: "Create a mail domain",
		tags,
	},
	{
		description:
			"The domain with each DNS record it needs (MX, SPF, DKIM, DMARC and the mail host's address) as public resolvers see it now.",
		method: "get",
		path: "/mail/domains/{domainId}",
		pathParams: domainIdParam,
		responses: {
			200: {
				description: "The mail domain",
				schema: mailDomainResponse.extend({
					records: z.array(mailRecordCheck),
				}),
			},
			401: unauthorized,
			404: notFound,
		},
		summary: "Get a mail domain",
		tags,
	},
	{
		description: `Deletes the domain with its mailboxes and aliases, and wipes their mail. ${sync}`,
		method: "delete",
		path: "/mail/domains/{domainId}",
		pathParams: domainIdParam,
		responses: { 204: deleted, 401: unauthorized, 404: notFound },
		summary: "Delete a mail domain",
		tags,
	},
	{
		method: "get",
		path: "/mail/mailboxes",
		responses: {
			200: {
				description:
					"Every mailbox and noreply address, by domain then address",
				isArray: true,
				schema: mailMailboxResponse,
			},
			401: unauthorized,
		},
		summary: "List mailboxes",
		tags,
	},
	{
		description: `Adds a mailbox, or with kind noreply a send-only address for apps. ${sync}`,
		method: "post",
		path: "/mail/mailboxes",
		requestBody: mailMailboxCreateApiBody,
		responses: {
			201: { description: "Created", schema: mailMailboxResponse },
			400: refused,
			401: unauthorized,
		},
		summary: "Create a mailbox",
		tags,
	},
	{
		method: "get",
		path: "/mail/mailboxes/{mailboxId}",
		pathParams: mailboxIdParam,
		responses: {
			200: { description: "The mailbox", schema: mailMailboxResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Get a mailbox",
		tags,
	},
	{
		description: `Changes the fields sent, keeping the rest; password sets a new one. Its kind can't change. ${sync}`,
		method: "patch",
		path: "/mail/mailboxes/{mailboxId}",
		pathParams: mailboxIdParam,
		requestBody: mailMailboxUpdateApiBody,
		responses: {
			200: { description: "Updated", schema: mailMailboxResponse },
			400: refused,
			401: unauthorized,
			404: notFound,
		},
		summary: "Update a mailbox",
		tags,
	},
	{
		description: `Deletes the mailbox and wipes its mail. ${sync}`,
		method: "delete",
		path: "/mail/mailboxes/{mailboxId}",
		pathParams: mailboxIdParam,
		responses: { 204: deleted, 401: unauthorized, 404: notFound },
		summary: "Delete a mailbox",
		tags,
	},
	{
		method: "get",
		path: "/mail/aliases",
		responses: {
			200: {
				description: "Every alias, by domain then address",
				isArray: true,
				schema: mailAliasResponse,
			},
			401: unauthorized,
		},
		summary: "List mail aliases",
		tags,
	},
	{
		description: `Adds an address forwarding to others; an empty localPart makes it the domain's catch-all. ${sync}`,
		method: "post",
		path: "/mail/aliases",
		requestBody: mailAliasCreateApiBody,
		responses: {
			201: { description: "Created", schema: mailAliasResponse },
			400: refused,
			401: unauthorized,
		},
		summary: "Create a mail alias",
		tags,
	},
	{
		method: "get",
		path: "/mail/aliases/{aliasId}",
		pathParams: aliasIdParam,
		responses: {
			200: { description: "The alias", schema: mailAliasResponse },
			401: unauthorized,
			404: notFound,
		},
		summary: "Get a mail alias",
		tags,
	},
	{
		description: `Changes its destinations or whether it's on, keeping what's left out. ${sync}`,
		method: "patch",
		path: "/mail/aliases/{aliasId}",
		pathParams: aliasIdParam,
		requestBody: mailAliasUpdateApiBody,
		responses: {
			200: { description: "Updated", schema: mailAliasResponse },
			400: refused,
			401: unauthorized,
			404: notFound,
		},
		summary: "Update a mail alias",
		tags,
	},
	{
		description: sync,
		method: "delete",
		path: "/mail/aliases/{aliasId}",
		pathParams: aliasIdParam,
		responses: { 204: deleted, 401: unauthorized, 404: notFound },
		summary: "Delete a mail alias",
		tags,
	},
];
