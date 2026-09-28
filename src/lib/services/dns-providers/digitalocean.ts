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

const API = "https://api.digitalocean.com/v2";

interface Page {
	links?: { pages?: { next?: string } };
}

interface DigitalOceanRecord {
	data: string;
	flags: number | null;
	id: number;
	name: string;
	priority: number | null;
	tag: string | null;
	ttl: number;
	type: string;
}

/** DigitalOcean's `{ id, message }` error body. */
function describe(body: unknown): string | null {
	return (body as { message?: string } | null)?.message ?? null;
}

/** A hostname target, where DigitalOcean's `@` means the zone apex. */
function target(data: string, zone: DnsZone): string {
	return data === "@" ? normalizeName(zone.name) : bareTarget(data);
}

/** A DigitalOcean record in the common shape, CAA rebuilt as `flags tag "value"`. */
function toRecord(zone: DnsZone, record: DigitalOceanRecord): DnsRecord {
	const content =
		record.type === "CNAME" || record.type === "MX" || record.type === "NS"
			? target(record.data, zone)
			: record.type === "TXT"
				? record.data.replace(/^"(.*)"$/s, "$1")
				: record.type === "CAA"
					? `${record.flags ?? 0} ${record.tag} "${record.data}"`
					: record.data;
	return {
		content,
		id: String(record.id),
		name: absoluteName(record.name, zone),
		priority: record.type === "MX" ? record.priority : null,
		ttl: record.ttl,
		type: record.type,
	};
}

/** The body DigitalOcean wants: relative name, FQDN targets with a trailing dot, CAA split into flags/tag/data. */
function toBody(zone: DnsZone, input: DnsRecordInput): Record<string, unknown> {
	const body: Record<string, unknown> = {
		data: input.content.trim(),
		name: relativeName(input.name, zone),
		type: input.type,
		...(input.ttl != null ? { ttl: input.ttl } : {}),
	};
	if (input.type === "CNAME" || input.type === "MX") {
		body.data = `${bareTarget(input.content)}.`;
	}
	if (input.type === "MX") {
		body.priority = input.priority ?? 10;
	}
	if (input.type === "CAA") {
		const match = /^(\d+)\s+(\S+)\s+"?(.*?)"?$/.exec(input.content.trim());
		if (!match) {
			throw new DnsProviderError(
				400,
				`CAA content must read like 0 issue "letsencrypt.org".`,
			);
		}
		body.flags = Number(match[1]);
		body.tag = match[2];
		body.data = match[3];
	}
	return body;
}

/** A DigitalOcean client authenticated with a personal access token carrying the domain scopes. */
export function digitalOceanClient(apiToken: string): DnsProviderClient {
	const call = <T>(path: string, init: RequestInit = {}): Promise<T> =>
		providerRequest<T>(
			"DigitalOcean",
			`${API}${path}`,
			{
				...init,
				headers: {
					authorization: `Bearer ${apiToken}`,
					"content-type": "application/json",
				},
			},
			describe,
		);
	const all = async <T>(path: string, key: string, page = 1): Promise<T[]> => {
		const body = await call<Page & Record<string, unknown>>(
			`${path}?per_page=200&page=${page}`,
		);
		const items = (body[key] as T[] | undefined) ?? [];
		return body.links?.pages?.next
			? [...items, ...(await all<T>(path, key, page + 1))]
			: items;
	};
	const records = (zone: DnsZone) =>
		`/domains/${encodeURIComponent(zone.id)}/records`;
	return {
		async createRecord(zone: DnsZone, input: DnsRecordInput) {
			const body = await call<{ domain_record: DigitalOceanRecord }>(
				records(zone),
				{
					body: JSON.stringify(toBody(zone, input)),
					method: "POST",
				},
			);
			return toRecord(zone, body.domain_record);
		},
		async deleteRecord(zone: DnsZone, record: DnsRecord) {
			try {
				await call(`${records(zone)}/${record.id}`, { method: "DELETE" });
			} catch (error) {
				if (!(error instanceof DnsProviderError && error.status === 404)) {
					throw error;
				}
			}
		},
		async listRecords(zone: DnsZone) {
			return (
				await all<DigitalOceanRecord>(records(zone), "domain_records")
			).map((record) => toRecord(zone, record));
		},
		async listZones() {
			return (await all<{ name: string }>("/domains", "domains")).map(
				(domain) => ({
					id: normalizeName(domain.name),
					name: normalizeName(domain.name),
				}),
			);
		},
		async updateRecord(
			zone: DnsZone,
			record: DnsRecord,
			input: DnsRecordInput,
		) {
			const body = await call<{ domain_record: DigitalOceanRecord }>(
				`${records(zone)}/${record.id}`,
				{ body: JSON.stringify(toBody(zone, input)), method: "PUT" },
			);
			return toRecord(zone, body.domain_record);
		},
	};
}

export const digitalocean: DnsProviderDefinition = {
	create: (credentials) => digitalOceanClient(credentials.apiToken ?? ""),
	docsUrl:
		"https://docs.digitalocean.com/reference/api/create-personal-access-token/",
	fields: [
		{
			help: "A personal access token with Full Access, or custom scopes domain:read, domain:create, domain:update and domain:delete.",
			key: "apiToken",
			label: "Personal access token",
			secret: true,
		},
	],
	id: "digitalocean",
	name: "DigitalOcean",
};
