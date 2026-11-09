import { z } from "zod";

const text = z.string().trim();
const displayName = text
	.nullable()
	.optional()
	.describe("The name shown beside the address. Null or empty clears it.");
const quotaMb = z
	.number()
	.int()
	.positive()
	.nullable()
	.optional()
	.describe(
		"Storage limit in MB, null for none. Ignored for a noreply address.",
	);
const ownerId = text
	.nullable()
	.optional()
	.describe(
		"The Homerun account that owns it and can change its password from their own account settings. Null for nobody.",
	);
const password = z
	.string()
	.describe(
		"Its sign-in password, 10 characters to 72 bytes. Write-only, never returned.",
	);

export const mailDomainApiBody = z.object({
	dnsDomainId: text
		.min(1)
		.describe(
			"The id of one of the DNS page's domains (GET /domains) to receive and sign mail for.",
		),
});

export const mailMailboxCreateApiBody = z.object({
	displayName,
	domainId: text.min(1).describe("The mail domain's id"),
	enabled: z
		.boolean()
		.optional()
		.describe("Whether it can sign in and receive mail. Defaults to true."),
	kind: z
		.enum(["mailbox", "noreply"])
		.optional()
		.describe(
			"mailbox: an inbox people read. noreply: send only, for apps sending transactional mail, incoming mail is refused. Defaults to mailbox.",
		),
	localPart: text.min(1).describe("The part before the @"),
	ownerId,
	password,
	quotaMb,
});

export const mailMailboxUpdateApiBody = z.object({
	displayName,
	enabled: z.boolean().optional(),
	ownerId,
	password: password.optional(),
	quotaMb,
});

export const mailAliasCreateApiBody = z.object({
	destinations: z
		.array(text.min(1))
		.min(1)
		.describe("The addresses mail to it is forwarded to"),
	domainId: text.min(1).describe("The mail domain's id"),
	enabled: z.boolean().optional().describe("Defaults to true."),
	localPart: text.describe(
		"The part before the @. Empty makes it the domain's catch-all.",
	),
});

export const mailAliasUpdateApiBody = z.object({
	destinations: z.array(text.min(1)).min(1).optional(),
	enabled: z.boolean().optional(),
});
