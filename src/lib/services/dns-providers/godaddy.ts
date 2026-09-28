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

const API = "https://api.godaddy.com/v1";
const DOMAIN_PAGE = 1000;
const RECORD_PAGE = 500;

interface GoDaddyRecord {
	data: string;
	name: string;
	priority?: number;
	ttl?: number;
	type: string;
}

interface GoDaddyError {
	code?: string;
	fields?: { message?: string; path?: string }[];
	message?: string;
}

/** GoDaddy's `code: message` plus each field error, with a hint on the account-size gate behind `ACCESS_DENIED`. */
function describe(body: unknown): string | null {
	const error = body as GoDaddyError | null;
	if (!error?.message) {
		return null;
	}
	const fields = (error.fields ?? [])
		.map((field) => ` [${field.path ?? "?"}: ${field.message ?? ""}]`)
		.join("");
	const hint =
		error.code === "ACCESS_DENIED"
			? " (GoDaddy only opens its production API to accounts with 10 or more domains or a Discount Domain Club plan)"
			: "";
	return `${error.code ? `${error.code}: ` : ""}${error.message}${fields}${hint}`;
}

/** A GoDaddy record in the common shape; `@` as a CNAME target means the apex. */
function toRecord(record: GoDaddyRecord, zone: DnsZone): DnsRecord {
	const name = absoluteName(record.name, zone);
	const hostTarget = ["CNAME", "MX", "NS"].includes(record.type);
	const content = hostTarget
		? record.data === "@"
			? normalizeName(zone.name)
			: bareTarget(record.data)
		: record.data;
	const priority = record.type === "MX" ? (record.priority ?? 0) : null;
	return {
		content,
		id: `${record.type}:${name}:${priority ?? ""}:${content}`,
		name,
		priority,
		ttl: record.ttl ?? null,
		type: record.type,
	};
}

/** The rrset entry GoDaddy wants for an input, without name or type. */
function toEntry(input: DnsRecordInput): Omit<GoDaddyRecord, "name" | "type"> {
	return {
		data: input.content,
		...(input.ttl != null ? { ttl: input.ttl } : {}),
		...(input.type === "MX" ? { priority: input.priority ?? 10 } : {}),
	};
}

type Entry = Omit<GoDaddyRecord, "name" | "type">;

/** An rrset entry without its name and type, as a PUT to `/records/{type}/{name}` wants it. */
function strip({ data, priority, ttl }: GoDaddyRecord): Entry {
	return {
		data,
		...(ttl != null ? { ttl } : {}),
		...(priority != null ? { priority } : {}),
	};
}

/**
 * A GoDaddy v1 client authenticated with an `sso-key key:secret` header.
 * GoDaddy addresses records by rrset (type + name), so updating or deleting
 * one value rewrites its rrset with the other values kept.
 */
class GoDaddyClient implements DnsProviderClient {
	readonly #authorization: string;

	/** Keeps the `sso-key` header value. */
	constructor(apiKey: string, apiSecret: string) {
		this.#authorization = `sso-key ${apiKey}:${apiSecret}`;
	}

	/**
	 * One call to the v1 API.
	 *
	 * @throws DnsProviderError carrying GoDaddy's `code: message` on a non-2xx.
	 */
	async #call<T>(path: string, init: RequestInit = {}): Promise<T> {
		return await providerRequest<T>(
			"GoDaddy",
			`${API}${path}`,
			{
				...init,
				headers: {
					accept: "application/json",
					authorization: this.#authorization,
					"content-type": "application/json",
				},
			},
			describe,
		);
	}

	/** The rrset's path. */
	#rrsetPath(zone: DnsZone, type: string, name: string): string {
		return `/domains/${zone.id}/records/${type}/${relativeName(name, zone)}`;
	}

	/** The rrset's entries other than `record`. */
	async #others(zone: DnsZone, record: DnsRecord): Promise<Entry[]> {
		const entries =
			(await this.#call<GoDaddyRecord[] | null>(
				this.#rrsetPath(zone, record.type, record.name),
			)) ?? [];
		return entries
			.filter(
				(entry) =>
					toRecord({ ...entry, name: record.name, type: record.type }, zone)
						.id !== record.id,
			)
			.map(strip);
	}

	/** Replaces the rrset with `entries`, or deletes it when there are none left (a 404 counts as gone). */
	async #put(
		zone: DnsZone,
		type: string,
		name: string,
		entries: Entry[],
	): Promise<void> {
		const path = this.#rrsetPath(zone, type, name);
		if (entries.length) {
			await this.#call(path, { body: JSON.stringify(entries), method: "PUT" });
			return;
		}
		try {
			await this.#call(path, { method: "DELETE" });
		} catch (error) {
			if (!(error instanceof DnsProviderError && error.status === 404)) {
				throw error;
			}
		}
	}

	/** Every record from `offset` on, a page at a time. */
	async #records(zone: DnsZone, offset: number): Promise<GoDaddyRecord[]> {
		const page =
			(await this.#call<GoDaddyRecord[] | null>(
				`/domains/${zone.id}/records?offset=${offset}&limit=${RECORD_PAGE}`,
			)) ?? [];
		return page.length < RECORD_PAGE
			? page
			: [...page, ...(await this.#records(zone, offset + RECORD_PAGE))];
	}

	/** Every domain after `marker`, a page at a time. */
	async #domains(marker: string): Promise<{ domain: string }[]> {
		const page =
			(await this.#call<{ domain: string }[] | null>(
				`/domains?limit=${DOMAIN_PAGE}${marker ? `&marker=${encodeURIComponent(marker)}` : ""}`,
			)) ?? [];
		const last = page.at(-1);
		return page.length < DOMAIN_PAGE || !last
			? page
			: [...page, ...(await this.#domains(last.domain))];
	}

	/** Appends the record with a PATCH, leaving the rest of the zone alone. */
	async createRecord(zone: DnsZone, input: DnsRecordInput): Promise<DnsRecord> {
		const record: GoDaddyRecord = {
			...toEntry(input),
			name: relativeName(input.name, zone),
			type: input.type,
		};
		await this.#call(`/domains/${zone.id}/records`, {
			body: JSON.stringify([record]),
			method: "PATCH",
		});
		return toRecord(record, zone);
	}

	/** Rewrites the record's rrset without it. */
	async deleteRecord(zone: DnsZone, record: DnsRecord): Promise<void> {
		await this.#put(
			zone,
			record.type,
			record.name,
			await this.#others(zone, record),
		);
	}

	/** Every record in the zone, all types. */
	async listRecords(zone: DnsZone): Promise<DnsRecord[]> {
		return (await this.#records(zone, 0)).map((record) =>
			toRecord(record, zone),
		);
	}

	/** Every domain on the account. */
	async listZones(): Promise<DnsZone[]> {
		return (await this.#domains("")).map((domain) => ({
			id: domain.domain,
			name: normalizeName(domain.domain),
		}));
	}

	/** Swaps the value within its rrset, or takes it out and adds it to another rrset when the name or type changes. */
	async updateRecord(
		zone: DnsZone,
		record: DnsRecord,
		input: DnsRecordInput,
	): Promise<DnsRecord> {
		const rest = await this.#others(zone, record);
		if (
			normalizeName(input.name) !== record.name ||
			input.type !== record.type
		) {
			await this.#put(zone, record.type, record.name, rest);
			return await this.createRecord(zone, input);
		}
		await this.#put(zone, record.type, record.name, [...rest, toEntry(input)]);
		return toRecord(
			{
				...toEntry(input),
				name: relativeName(input.name, zone),
				type: input.type,
			},
			zone,
		);
	}
}

/** A GoDaddy client for this key and secret. */
export function godaddyClient(
	apiKey: string,
	apiSecret: string,
): DnsProviderClient {
	return new GoDaddyClient(apiKey, apiSecret);
}

export const godaddy: DnsProviderDefinition = {
	create: (credentials) =>
		godaddyClient(credentials.apiKey ?? "", credentials.apiSecret ?? ""),
	docsUrl: "https://developer.godaddy.com/keys",
	fields: [
		{
			help: "A Production key from developer.godaddy.com/keys (not an OTE test key). GoDaddy only allows its Domains API for accounts with 10 or more domains or a Discount Domain Club plan; smaller accounts get ACCESS_DENIED.",
			key: "apiKey",
			label: "API key",
			secret: false,
		},
		{
			help: "The secret shown once next to that key.",
			key: "apiSecret",
			label: "API secret",
			secret: true,
		},
	],
	id: "godaddy",
	name: "GoDaddy",
};
