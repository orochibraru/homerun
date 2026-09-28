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

const API = "https://api.vultr.com/v2";

interface Page {
	meta?: { links?: { next?: string } };
}

interface VultrRecord {
	data: string;
	id: string;
	name: string;
	priority: number;
	ttl: number;
	type: string;
}

/** Vultr's `{ error, status }` body. */
function describe(body: unknown): string | null {
	return (body as { error?: string } | null)?.error || null;
}

/** A Vultr record in the common shape, TXT unquoted. */
function toRecord(zone: DnsZone, record: VultrRecord): DnsRecord {
	const content =
		record.type === "CNAME" || record.type === "MX" || record.type === "NS"
			? bareTarget(record.data)
			: record.type === "TXT"
				? record.data.replace(/^"(.*)"$/s, "$1")
				: record.data;
	return {
		content,
		id: record.id,
		name: absoluteName(record.name, zone),
		priority: record.type === "MX" ? record.priority : null,
		ttl: record.ttl,
		type: record.type,
	};
}

/** The body Vultr wants: a name relative to the domain (empty at the apex), TXT quoted. */
function toBody(
	zone: DnsZone,
	input: DnsRecordInput,
): Omit<VultrRecord, "id" | "priority" | "ttl"> & {
	priority?: number;
	ttl?: number;
} {
	const name = relativeName(input.name, zone);
	return {
		data:
			input.type === "TXT"
				? `"${input.content}"`
				: input.type === "CNAME" || input.type === "MX"
					? bareTarget(input.content)
					: input.content.trim(),
		name: name === "@" ? "" : name,
		type: input.type,
		...(input.type === "MX" ? { priority: input.priority ?? 10 } : {}),
		...(input.ttl != null ? { ttl: input.ttl } : {}),
	};
}

/** A Vultr v2 client authenticated with an account API key whose access control allows this server's IP. */
export function vultrClient(apiKey: string): DnsProviderClient {
	const call = <T>(path: string, init: RequestInit = {}): Promise<T> =>
		providerRequest<T>(
			"Vultr",
			`${API}${path}`,
			{
				...init,
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
			},
			describe,
		);
	const all = async <T>(
		path: string,
		key: string,
		cursor = "",
	): Promise<T[]> => {
		const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
		const body = await call<Page & Record<string, unknown>>(
			`${path}?per_page=500${query}`,
		);
		const items = (body[key] as T[] | undefined) ?? [];
		const next = body.meta?.links?.next;
		return next ? [...items, ...(await all<T>(path, key, next))] : items;
	};
	const records = (zone: DnsZone) =>
		`/domains/${encodeURIComponent(zone.id)}/records`;
	return {
		async createRecord(zone: DnsZone, input: DnsRecordInput) {
			const body = await call<{ record: VultrRecord }>(records(zone), {
				body: JSON.stringify(toBody(zone, input)),
				method: "POST",
			});
			return toRecord(zone, body.record);
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
			return (await all<VultrRecord>(records(zone), "records")).map((record) =>
				toRecord(zone, record),
			);
		},
		async listZones() {
			return (await all<{ domain: string }>("/domains", "domains")).map(
				(domain) => ({
					id: normalizeName(domain.domain),
					name: normalizeName(domain.domain),
				}),
			);
		},
		async updateRecord(
			zone: DnsZone,
			record: DnsRecord,
			input: DnsRecordInput,
		) {
			const body = toBody(zone, input);
			await call(`${records(zone)}/${record.id}`, {
				body: JSON.stringify(body),
				method: "PATCH",
			});
			return toRecord(zone, {
				...body,
				id: record.id,
				priority: body.priority ?? 0,
				ttl: body.ttl ?? record.ttl ?? 300,
			});
		},
	};
}

export const vultr: DnsProviderDefinition = {
	create: (credentials) => vultrClient(credentials.apiKey ?? ""),
	docsUrl: "https://docs.vultr.com/platform/other/api/enable-user-api-access",
	fields: [
		{
			help: "The Personal Access Token from Account → API (Enable API). Its Access Control list must allow this server's public IP; for a narrower key, create a sub-user with only the Manage DNS permission and use its API key.",
			key: "apiKey",
			label: "API key",
			secret: true,
		},
	],
	id: "vultr",
	name: "Vultr",
};
