import { and, asc, eq } from "drizzle-orm";

import { db } from "#lib/server/db/lib.js";
import {
	mailDomain,
	type MailMailbox,
	mailMailbox,
} from "#lib/server/db/schema.js";

import { BaseDTO } from "./base-dto";

export type MailMailboxSummary = Omit<MailMailbox, "passwordHash"> & {
	address: string;
	domain: string;
};

export type MailMailboxKind = MailMailbox["kind"];

export interface MailMailboxFields {
	displayName: string | null;
	enabled: boolean;
	ownerId: string | null;
	quotaMb: number | null;
}

/** Wraps the `mail_mailbox` table: an account that receives mail and signs in over IMAP and SMTP. */
export class MailMailboxDTO extends BaseDTO<MailMailbox> {
	readonly domain: string;

	private constructor(row: MailMailbox, domain: string) {
		super(row);
		this.domain = domain;
	}

	/** Loads one mailbox by id with its domain's name; null when missing. */
	static async get(id: string): Promise<MailMailboxDTO | null> {
		const [found] = await db
			.select({ domain: mailDomain.name, row: mailMailbox })
			.from(mailMailbox)
			.innerJoin(mailDomain, eq(mailMailbox.domainId, mailDomain.id))
			.where(eq(mailMailbox.id, id))
			.limit(1);
		return found ? new MailMailboxDTO(found.row, found.domain) : null;
	}

	/** Every mailbox with its domain's name, by domain then address. */
	static async list(): Promise<MailMailboxDTO[]> {
		const rows = await db
			.select({ domain: mailDomain.name, row: mailMailbox })
			.from(mailMailbox)
			.innerJoin(mailDomain, eq(mailMailbox.domainId, mailDomain.id))
			.orderBy(asc(mailDomain.name), asc(mailMailbox.localPart));
		return rows.map((found) => new MailMailboxDTO(found.row, found.domain));
	}

	/** The mailboxes `ownerId` owns, by domain then address. */
	static async listForOwner(ownerId: string): Promise<MailMailboxDTO[]> {
		const rows = await db
			.select({ domain: mailDomain.name, row: mailMailbox })
			.from(mailMailbox)
			.innerJoin(mailDomain, eq(mailMailbox.domainId, mailDomain.id))
			.where(eq(mailMailbox.ownerId, ownerId))
			.orderBy(asc(mailDomain.name), asc(mailMailbox.localPart));
		return rows.map((found) => new MailMailboxDTO(found.row, found.domain));
	}

	/** Loads one mailbox by id when `ownerId` owns it; null otherwise. */
	static async getOwned(
		id: string,
		ownerId: string,
	): Promise<MailMailboxDTO | null> {
		const [found] = await db
			.select({ domain: mailDomain.name, row: mailMailbox })
			.from(mailMailbox)
			.innerJoin(mailDomain, eq(mailMailbox.domainId, mailDomain.id))
			.where(and(eq(mailMailbox.id, id), eq(mailMailbox.ownerId, ownerId)))
			.limit(1);
		return found ? new MailMailboxDTO(found.row, found.domain) : null;
	}

	/** Inserts a mailbox under a domain. */
	static async create(
		input: MailMailboxFields & {
			domain: string;
			domainId: string;
			kind: MailMailboxKind;
			localPart: string;
			passwordHash: string;
		},
	): Promise<MailMailboxDTO> {
		const now = new Date();
		const row: MailMailbox = {
			createdAt: now,
			displayName: input.displayName,
			domainId: input.domainId,
			enabled: input.enabled,
			id: crypto.randomUUID(),
			kind: input.kind,
			localPart: input.localPart,
			ownerId: input.ownerId,
			passwordHash: input.passwordHash,
			quotaMb: input.quotaMb,
			updatedAt: now,
		};
		await db.insert(mailMailbox).values(row);
		return new MailMailboxDTO(row, input.domain);
	}

	/** The mailbox's full address. */
	get address(): string {
		return `${this.row.localPart}@${this.domain}`;
	}

	/** Whether it's a mailbox people read, or a send-only noreply address. */
	get kind(): MailMailboxKind {
		return this.row.kind;
	}

	/** The stored bcrypt hash docker-mailserver's accounts file gets. */
	get passwordHash(): string {
		return this.row.passwordHash;
	}

	/** The row with its address, without the password hash, what pages get. */
	summary(): MailMailboxSummary {
		const { passwordHash: _hash, ...rest } = this.row;
		return { ...rest, address: this.address, domain: this.domain };
	}

	/** Saves the editable fields. */
	async update(fields: MailMailboxFields): Promise<void> {
		const patch = { ...fields, updatedAt: new Date() };
		await db
			.update(mailMailbox)
			.set(patch)
			.where(eq(mailMailbox.id, this.row.id));
		Object.assign(this.row, patch);
	}

	/** Replaces the password hash. */
	async setPasswordHash(passwordHash: string): Promise<void> {
		const patch = { passwordHash, updatedAt: new Date() };
		await db
			.update(mailMailbox)
			.set(patch)
			.where(eq(mailMailbox.id, this.row.id));
		Object.assign(this.row, patch);
	}

	/** Deletes the mailbox row. Its mail on disk is purged separately. */
	async delete(): Promise<void> {
		await db.delete(mailMailbox).where(eq(mailMailbox.id, this.row.id));
	}
}
