import { asc, eq } from "drizzle-orm";
import { db } from "#lib/server/db/lib.js";
import { type DnsConnection, dnsConnection } from "#lib/server/db/schema.js";
import { dnsProviderById } from "#lib/services/dns-providers/index.js";
import type {
	DnsCredentials,
	DnsProviderClient,
} from "#lib/services/dns-providers/types.js";
import { decryptSecret, encryptSecret } from "#lib/services/secrets.js";
import { BaseDTO } from "./base-dto";

export interface DnsConnectionSummary {
	createdAt: Date;
	id: string;
	name: string;
	provider: string;
	providerName: string;
	setFields: string[];
}

/**
 * Wraps `dns_connection`: an account at a DNS provider Homerun manages
 * records through. Its credentials are stored per field, secret ones
 * encrypted (`encryptSecret`), and only ever decrypted to build the
 * provider's client.
 */
export class DnsConnectionDTO extends BaseDTO<DnsConnection> {
	/** Every connection, oldest first. */
	static async list(): Promise<DnsConnectionDTO[]> {
		const rows = await db
			.select()
			.from(dnsConnection)
			.orderBy(asc(dnsConnection.createdAt));
		return rows.map((row) => new DnsConnectionDTO(row));
	}

	/** One connection, null when it doesn't exist. */
	static async get(id: string): Promise<DnsConnectionDTO | null> {
		const [row] = await db
			.select()
			.from(dnsConnection)
			.where(eq(dnsConnection.id, id))
			.limit(1);
		return row ? new DnsConnectionDTO(row) : null;
	}

	/**
	 * Stores a new connection, encrypting the provider's secret fields.
	 *
	 * @throws When the provider is unknown.
	 */
	static async create(input: {
		credentials: DnsCredentials;
		name: string;
		provider: string;
		userId: string;
	}): Promise<DnsConnectionDTO> {
		const now = new Date();
		const row: DnsConnection = {
			createdAt: now,
			credentials: sealCredentials(input.provider, input.credentials, {}),
			id: crypto.randomUUID(),
			name: input.name,
			provider: input.provider,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(dnsConnection).values(row);
		return new DnsConnectionDTO(row);
	}

	/** Renames the connection and replaces the credentials typed in; a blank secret field keeps the stored one. */
	async update(input: {
		credentials: DnsCredentials;
		name: string;
	}): Promise<void> {
		const patch = {
			credentials: sealCredentials(
				this.row.provider,
				input.credentials,
				this.row.credentials,
			),
			name: input.name,
			updatedAt: new Date(),
		};
		await db
			.update(dnsConnection)
			.set(patch)
			.where(eq(dnsConnection.id, this.row.id));
		Object.assign(this.row, patch);
	}

	/** Deletes the connection; its domains stay, without automation. */
	async delete(): Promise<void> {
		await db.delete(dnsConnection).where(eq(dnsConnection.id, this.row.id));
	}

	/**
	 * The provider's client, built from the decrypted credentials.
	 *
	 * @throws When the provider isn't known any more, or a secret can't be decrypted.
	 */
	client(): DnsProviderClient {
		const definition = dnsProviderById(this.row.provider);
		if (!definition) {
			throw new Error(`Unknown DNS provider "${this.row.provider}".`);
		}
		const credentials: DnsCredentials = {};
		for (const field of definition.fields) {
			const stored = this.row.credentials[field.key];
			if (!stored) {
				continue;
			}
			const value = field.secret ? decryptSecret(stored) : stored;
			if (value === null) {
				throw new Error(
					`The ${field.label} of ${this.row.name} can't be decrypted: enter it again.`,
				);
			}
			credentials[field.key] = value;
		}
		return definition.create(credentials);
	}

	/** The connection's id. */
	get id(): string {
		return this.row.id;
	}

	/** The connection's display name. */
	get name(): string {
		return this.row.name;
	}

	/** Everything but the credentials, and which of them are set. */
	summary(): DnsConnectionSummary {
		return {
			createdAt: this.row.createdAt,
			id: this.row.id,
			name: this.row.name,
			provider: this.row.provider,
			providerName:
				dnsProviderById(this.row.provider)?.name ?? this.row.provider,
			setFields: Object.keys(this.row.credentials).filter(
				(key) => this.row.credentials[key],
			),
		};
	}
}

/**
 * The credentials to store for `provider`: each of its fields from
 * `input`, a secret one encrypted, and a blank one kept from `previous`.
 *
 * @throws When the provider is unknown.
 */
function sealCredentials(
	provider: string,
	input: DnsCredentials,
	previous: Record<string, string>,
): Record<string, string> {
	const definition = dnsProviderById(provider);
	if (!definition) {
		throw new Error(`Unknown DNS provider "${provider}".`);
	}
	const sealed: Record<string, string> = {};
	for (const field of definition.fields) {
		const value = input[field.key]?.trim();
		if (value) {
			sealed[field.key] = field.secret ? encryptSecret(value) : value;
		} else if (previous[field.key]) {
			sealed[field.key] = previous[field.key] as string;
		}
	}
	return sealed;
}
