import { asc, eq } from "drizzle-orm";

import { mailAddress } from "#lib/mail.js";
import { db } from "#lib/server/db/lib.js";
import {
	type MailAlias,
	mailAlias,
	mailDomain,
} from "#lib/server/db/schema.js";

import { BaseDTO } from "./base-dto";

export type MailAliasSummary = MailAlias & { address: string; domain: string };

export interface MailAliasFields {
	destinations: string[];
	enabled: boolean;
}

/** Wraps the `mail_alias` table: an address forwarding to one or more others, `@domain` with an empty local part catching everything else. */
export class MailAliasDTO extends BaseDTO<MailAlias> {
	readonly domain: string;

	private constructor(row: MailAlias, domain: string) {
		super(row);
		this.domain = domain;
	}

	/** Loads one alias by id with its domain's name; null when missing. */
	static async get(id: string): Promise<MailAliasDTO | null> {
		const [found] = await db
			.select({ domain: mailDomain.name, row: mailAlias })
			.from(mailAlias)
			.innerJoin(mailDomain, eq(mailAlias.domainId, mailDomain.id))
			.where(eq(mailAlias.id, id))
			.limit(1);
		return found ? new MailAliasDTO(found.row, found.domain) : null;
	}

	/** Every alias with its domain's name, by domain then address. */
	static async list(): Promise<MailAliasDTO[]> {
		const rows = await db
			.select({ domain: mailDomain.name, row: mailAlias })
			.from(mailAlias)
			.innerJoin(mailDomain, eq(mailAlias.domainId, mailDomain.id))
			.orderBy(asc(mailDomain.name), asc(mailAlias.localPart));
		return rows.map((found) => new MailAliasDTO(found.row, found.domain));
	}

	/** Inserts an alias under a domain. */
	static async create(
		input: MailAliasFields & {
			domain: string;
			domainId: string;
			localPart: string;
		},
	): Promise<MailAliasDTO> {
		const now = new Date();
		const row: MailAlias = {
			createdAt: now,
			destinations: input.destinations,
			domainId: input.domainId,
			enabled: input.enabled,
			id: crypto.randomUUID(),
			localPart: input.localPart,
			updatedAt: now,
		};
		await db.insert(mailAlias).values(row);
		return new MailAliasDTO(row, input.domain);
	}

	/** The alias's address, `@domain` for a catch-all. */
	get address(): string {
		return mailAddress(this.row.localPart, this.domain);
	}

	/** The row with its address, what pages get. */
	summary(): MailAliasSummary {
		return { ...this.row, address: this.address, domain: this.domain };
	}

	/** Saves the editable fields. */
	async update(fields: MailAliasFields): Promise<void> {
		const patch = { ...fields, updatedAt: new Date() };
		await db.update(mailAlias).set(patch).where(eq(mailAlias.id, this.row.id));
		Object.assign(this.row, patch);
	}

	/** Deletes the alias row. */
	async delete(): Promise<void> {
		await db.delete(mailAlias).where(eq(mailAlias.id, this.row.id));
	}
}
