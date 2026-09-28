import {
	absoluteName,
	bareTarget,
	DnsProviderError,
	normalizeName,
	providerRequest,
	relativeName,
} from "./http";
import type {
	DnsProviderClient,
	DnsProviderDefinition,
	DnsRecord,
	DnsRecordInput,
	DnsZone,
} from "./types";

const API = "https://api.scaleway.com/domain/v2beta1";
const DEFAULT_TTL = 3600;
const PAGE_SIZE = 100;
const PROVIDER = "Scaleway";

interface ScalewayRecord {
	data: string;
	id: string;
	name: string;
	priority?: number;
	ttl: number;
	type: string;
}

interface ScalewayZone {
	domain: string;
	subdomain?: string;
}

/** Scaleway's `{ message, details }` body. */
function describe(body: unknown): string | null {
	const shaped = body as {
		details?: {
			argument_name?: string;
			help_message?: string;
			reason?: string;
		}[];
		message?: string;
	} | null;
	if (!shaped?.message) {
		return null;
	}
	const details = (shaped.details ?? [])
		.map((detail) =>
			[detail.argument_name, detail.help_message ?? detail.reason]
				.filter(Boolean)
				.join(": "),
		)
		.filter(Boolean);
	return details.length
		? `${shaped.message} (${details.join("; ")})`
		: shaped.message;
}

/** The record data unquoted for TXT and without a root dot for hostnames. */
function content(type: string, data: string): string {
	if (type === "TXT") {
		const chunks = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
			(match[1] ?? "").replace(/\\(.)/g, "$1"),
		);
		return chunks.length ? chunks.join("") : data;
	}
	return type === "CNAME" || type === "MX" || type === "NS" || type === "PTR"
		? bareTarget(data)
		: data;
}

/** A Scaleway record in the common shape. */
function toRecord(record: ScalewayRecord, zone: DnsZone): DnsRecord {
	return {
		content: content(record.type, record.data),
		id: record.id,
		name: absoluteName(record.name, zone),
		priority: record.type === "MX" ? (record.priority ?? 0) : null,
		ttl: record.ttl,
		type: record.type,
	};
}

/** The record Scaleway wants: a relative name (empty at the apex), quoted TXT, absolute targets. */
function toBody(zone: DnsZone, input: DnsRecordInput): Record<string, unknown> {
	const name = relativeName(input.name, zone);
	const data =
		input.type === "TXT"
			? `"${input.content.replace(/(["\\])/g, "\\$1")}"`
			: input.type === "CNAME" || input.type === "MX"
				? `${bareTarget(input.content)}.`
				: input.content;
	return {
		data,
		name: name === "@" ? "" : name,
		priority: input.type === "MX" ? (input.priority ?? 10) : 0,
		ttl: input.ttl ?? DEFAULT_TTL,
		type: input.type,
	};
}

/** A Scaleway Domains and DNS client authenticated with an API secret key, optionally scoped to one project. */
export class ScalewayClient implements DnsProviderClient {
	readonly #secretKey: string;
	readonly #projectId: string | undefined;

	/** Keeps the key and the optional project filter. */
	constructor(secretKey: string, projectId?: string) {
		this.#secretKey = secretKey;
		this.#projectId = projectId;
	}

	/** One authenticated call. */
	#call<T>(path: string, init: RequestInit = {}): Promise<T> {
		return providerRequest<T>(
			PROVIDER,
			`${API}${path}`,
			{
				...init,
				headers: {
					"content-type": "application/json",
					"x-auth-token": this.#secretKey,
				},
			},
			describe,
		);
	}

	/** Every item of a paged list, page by page until `total_count` is reached. */
	async #all<T>(
		path: string,
		field: string,
		query: Record<string, string> = {},
	): Promise<T[]> {
		const page = Number(query.page ?? 1);
		const params = new URLSearchParams({
			...query,
			page: String(page),
			page_size: String(PAGE_SIZE),
		});
		const body = await this.#call<Record<string, unknown> | null>(
			`${path}?${params}`,
		);
		const items = (body?.[field] as T[] | undefined) ?? [];
		const more =
			items.length > 0 &&
			(page - 1) * PAGE_SIZE + items.length < Number(body?.total_count ?? 0);
		return more
			? [
					...items,
					...(await this.#all<T>(path, field, {
						...query,
						page: String(page + 1),
					})),
				]
			: items;
	}

	/** Applies one change through the zone's records PATCH, answering the records it touched. */
	#patch(
		zone: DnsZone,
		change: Record<string, unknown>,
	): Promise<{ records?: ScalewayRecord[] }> {
		return this.#call(`/dns-zones/${encodeURIComponent(zone.id)}/records`, {
			body: JSON.stringify({ changes: [change], return_all_records: false }),
			method: "PATCH",
		});
	}

	/**
	 * The written record out of a PATCH answer, matched on what was sent.
	 *
	 * @throws DnsProviderError when the answer holds no record.
	 */
	#written(
		zone: DnsZone,
		body: Record<string, unknown>,
		records: ScalewayRecord[] | undefined,
	): DnsRecord {
		const match =
			records?.find(
				(record) =>
					record.type === body.type &&
					record.name === body.name &&
					record.data === body.data,
			) ?? records?.[0];
		if (!match) {
			throw new DnsProviderError(
				200,
				`${PROVIDER}: the change was accepted but no record came back.`,
			);
		}
		return toRecord(match, zone);
	}

	/** Adds one record. */
	async createRecord(zone: DnsZone, input: DnsRecordInput): Promise<DnsRecord> {
		const body = toBody(zone, input);
		const answer = await this.#patch(zone, { add: { records: [body] } });
		return this.#written(zone, body, answer.records);
	}

	/** Deletes the record by id; a 404 means it's already gone. */
	async deleteRecord(zone: DnsZone, record: DnsRecord): Promise<void> {
		try {
			await this.#patch(zone, { delete: { id: record.id } });
		} catch (error) {
			if (!(error instanceof DnsProviderError && error.status === 404)) {
				throw error;
			}
		}
	}

	/** Every record in the zone. */
	async listRecords(zone: DnsZone): Promise<DnsRecord[]> {
		const records = await this.#all<ScalewayRecord>(
			`/dns-zones/${encodeURIComponent(zone.id)}/records`,
			"records",
		);
		return records.map((record) => toRecord(record, zone));
	}

	/** Every DNS zone the key can see (in the project when one is set), a subdomain zone named in full. */
	async listZones(): Promise<DnsZone[]> {
		const zones = await this.#all<ScalewayZone>(
			"/dns-zones",
			"dns_zones",
			this.#projectId ? { project_id: this.#projectId } : {},
		);
		return zones.map((zone) => {
			const name = normalizeName(
				zone.subdomain ? `${zone.subdomain}.${zone.domain}` : zone.domain,
			);
			return { id: name, name };
		});
	}

	/** Replaces the record in place by id. */
	async updateRecord(
		zone: DnsZone,
		record: DnsRecord,
		input: DnsRecordInput,
	): Promise<DnsRecord> {
		const body = toBody(zone, input);
		const answer = await this.#patch(zone, {
			set: { id: record.id, records: [body] },
		});
		return this.#written(zone, body, answer.records);
	}
}

export const scaleway: DnsProviderDefinition = {
	create: (credentials) =>
		new ScalewayClient(
			credentials.secretKey ?? "",
			credentials.projectId?.trim() || undefined,
		),
	docsUrl: "https://www.scaleway.com/en/docs/iam/how-to/create-api-keys/",
	fields: [
		{
			help: "The secret key of an API key whose IAM policy grants DomainsDNSFullAccess on the project holding the zones.",
			key: "secretKey",
			label: "Secret key",
			secret: true,
		},
		{
			help: "Only list the zones of this project; leave empty for every project the key can see.",
			key: "projectId",
			label: "Project ID",
			optional: true,
			secret: false,
		},
	],
	id: "scaleway",
	name: "Scaleway",
};
