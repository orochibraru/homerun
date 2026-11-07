import { asc, eq } from "drizzle-orm";

import { db } from "#lib/server/db/lib.js";
import { type MailDomain, mailDomain } from "#lib/server/db/schema.js";
import { decryptSecret, encryptSecret } from "#lib/services/secrets.js";

import { BaseDTO } from "./base-dto";

export type MailDomainSummary = Omit<MailDomain, "dkimPrivateKeyEnc">;

/** Wraps the `mail_domain` table: a domain the mail server receives and signs mail for, with its DKIM key pair. */
export class MailDomainDTO extends BaseDTO<MailDomain> {
	/** Loads one mail domain by id; null when missing. */
	static async get(id: string): Promise<MailDomainDTO | null> {
		const [row] = await db
			.select()
			.from(mailDomain)
			.where(eq(mailDomain.id, id))
			.limit(1);
		return row ? new MailDomainDTO(row) : null;
	}

	/** Loads the mail domain with this exact name; null when none. */
	static async getByName(name: string): Promise<MailDomainDTO | null> {
		const [row] = await db
			.select()
			.from(mailDomain)
			.where(eq(mailDomain.name, name))
			.limit(1);
		return row ? new MailDomainDTO(row) : null;
	}

	/** Every mail domain, alphabetically. */
	static async list(): Promise<MailDomainDTO[]> {
		const rows = await db
			.select()
			.from(mailDomain)
			.orderBy(asc(mailDomain.name));
		return rows.map((row) => new MailDomainDTO(row));
	}

	/** Inserts a mail domain, encrypting its DKIM private key. */
	static async create(input: {
		dkimPrivateKey: string;
		dkimPublicKey: string;
		dkimSelector: string;
		name: string;
		userId: string;
	}): Promise<MailDomainDTO> {
		const now = new Date();
		const row: MailDomain = {
			createdAt: now,
			dkimPrivateKeyEnc: encryptSecret(input.dkimPrivateKey),
			dkimPublicKey: input.dkimPublicKey,
			dkimSelector: input.dkimSelector,
			id: crypto.randomUUID(),
			name: input.name,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(mailDomain).values(row);
		return new MailDomainDTO(row);
	}

	/** The domain row's id. */
	get id(): string {
		return this.row.id;
	}

	/** The domain name, e.g. example.com. */
	get name(): string {
		return this.row.name;
	}

	/** The DKIM private key in PEM; null when it can't be decrypted. */
	dkimPrivateKey(): string | null {
		return decryptSecret(this.row.dkimPrivateKeyEnc);
	}

	/** The row without its encrypted private key, what pages get. */
	summary(): MailDomainSummary {
		const { dkimPrivateKeyEnc: _secret, ...rest } = this.row;
		return rest;
	}

	/** Deletes the domain, its mailboxes and aliases with it. */
	async delete(): Promise<void> {
		await db.delete(mailDomain).where(eq(mailDomain.id, this.row.id));
	}
}
