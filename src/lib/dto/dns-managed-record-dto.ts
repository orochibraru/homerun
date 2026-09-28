import { and, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type DnsManagedRecord, dnsManagedRecord } from "$lib/server/db/schema";
import { normalizeName } from "$lib/services/dns-providers/http";
import type { DnsRecord } from "$lib/services/dns-providers/types";
import { BaseDTO } from "./base-dto";

/**
 * Wraps `dns_managed_record`: the records Homerun created itself at a
 * provider, so it only ever updates or deletes those and never a record
 * someone made by hand, which most providers have no field to tell apart.
 */
export class DnsManagedRecordDTO extends BaseDTO<DnsManagedRecord> {
	/** The record Homerun manages for `name` in a domain, null when it doesn't manage one. */
	static async find(
		domainId: string,
		name: string,
	): Promise<DnsManagedRecordDTO | null> {
		const [row] = await db
			.select()
			.from(dnsManagedRecord)
			.where(
				and(
					eq(dnsManagedRecord.domainId, domainId),
					eq(dnsManagedRecord.name, normalizeName(name)),
				),
			)
			.limit(1);
		return row ? new DnsManagedRecordDTO(row) : null;
	}

	/** Every record Homerun manages in a domain. */
	static async listForDomain(domainId: string): Promise<DnsManagedRecordDTO[]> {
		const rows = await db
			.select()
			.from(dnsManagedRecord)
			.where(eq(dnsManagedRecord.domainId, domainId));
		return rows.map((row) => new DnsManagedRecordDTO(row));
	}

	/** Records that Homerun now manages `record`, replacing what it tracked for that name. */
	static async track(domainId: string, record: DnsRecord): Promise<void> {
		const name = normalizeName(record.name);
		await db
			.delete(dnsManagedRecord)
			.where(
				and(
					eq(dnsManagedRecord.domainId, domainId),
					eq(dnsManagedRecord.name, name),
				),
			);
		await db.insert(dnsManagedRecord).values({
			content: record.content,
			createdAt: new Date(),
			domainId,
			id: crypto.randomUUID(),
			name,
			recordId: record.id,
			type: record.type,
		});
	}

	/** Stops tracking this record. */
	async untrack(): Promise<void> {
		await db
			.delete(dnsManagedRecord)
			.where(eq(dnsManagedRecord.id, this.row.id));
	}

	/** The record as the provider knows it, for updating or deleting it. */
	asRecord(): DnsRecord {
		return {
			content: this.row.content,
			id: this.row.recordId,
			name: this.row.name,
			priority: null,
			ttl: null,
			type: this.row.type,
		};
	}
}
