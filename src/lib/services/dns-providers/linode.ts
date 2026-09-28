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

const API = "https://api.linode.com/v4";

interface Page<T> {
	data: T[];
	page: number;
	pages: number;
}

interface LinodeRecord {
	id: number;
	name: string;
	priority: number;
	tag: string | null;
	target: string;
	ttl_sec: number;
	type: string;
}

/** Linode's `errors[]` as `field: reason` entries. */
function describe(body: unknown): string | null {
	const errors = (
		body as { errors?: { field?: string; reason: string }[] } | null
	)?.errors;
	return errors?.length
		? errors
				.map((error) =>
					error.field ? `${error.field}: ${error.reason}` : error.reason,
				)
				.join("; ")
		: null;
}

/** A Linode record in the common shape, CAA rebuilt as `0 tag "value"`, a TTL of 0 meaning the domain default. */
function toRecord(zone: DnsZone, record: LinodeRecord): DnsRecord {
	const content =
		record.type === "CNAME" || record.type === "MX" || record.type === "NS"
			? bareTarget(record.target)
			: record.type === "TXT"
				? record.target.replace(/^"(.*)"$/s, "$1")
				: record.type === "CAA"
					? `0 ${record.tag} "${record.target}"`
					: record.target;
	return {
		content,
		id: String(record.id),
		name: absoluteName(record.name, zone),
		priority: record.type === "MX" ? record.priority : null,
		ttl: record.ttl_sec || null,
		type: record.type,
	};
}

/** The body Linode wants: a name relative to the domain (empty at the apex), CAA split into tag and target. */
function toBody(zone: DnsZone, input: DnsRecordInput): Record<string, unknown> {
	const name = relativeName(input.name, zone);
	const body: Record<string, unknown> = {
		name: name === "@" ? "" : name,
		target:
			input.type === "CNAME" || input.type === "MX"
				? bareTarget(input.content)
				: input.content.trim(),
		ttl_sec: input.ttl ?? 0,
		type: input.type,
	};
	if (input.type === "MX") {
		body.priority = input.priority ?? 10;
	}
	if (input.type === "CAA") {
		const match = /^(?:\d+\s+)?(\S+)\s+"?(.*?)"?$/.exec(input.content.trim());
		if (!match) {
			throw new DnsProviderError(
				400,
				`CAA content must read like 0 issue "letsencrypt.org".`,
			);
		}
		body.tag = match[1];
		body.target = match[2];
	}
	return body;
}

/** A Linode (Akamai) client authenticated with a personal access token with Domains Read/Write. */
export function linodeClient(apiToken: string): DnsProviderClient {
	const call = <T>(path: string, init: RequestInit = {}): Promise<T> =>
		providerRequest<T>(
			"Linode",
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
	const all = async <T>(path: string, page = 1): Promise<T[]> => {
		const body = await call<Page<T>>(`${path}?page=${page}&page_size=500`);
		return body.pages > page
			? [...body.data, ...(await all<T>(path, page + 1))]
			: body.data;
	};
	const records = (zone: DnsZone) => `/domains/${zone.id}/records`;
	return {
		async createRecord(zone: DnsZone, input: DnsRecordInput) {
			return toRecord(
				zone,
				await call<LinodeRecord>(records(zone), {
					body: JSON.stringify(toBody(zone, input)),
					method: "POST",
				}),
			);
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
			return (await all<LinodeRecord>(records(zone))).map((record) =>
				toRecord(zone, record),
			);
		},
		async listZones() {
			return (
				await all<{ domain: string; id: number; type: string }>("/domains")
			)
				.filter((domain) => domain.type === "master")
				.map((domain) => ({
					id: String(domain.id),
					name: normalizeName(domain.domain),
				}));
		},
		async updateRecord(
			zone: DnsZone,
			record: DnsRecord,
			input: DnsRecordInput,
		) {
			return toRecord(
				zone,
				await call<LinodeRecord>(`${records(zone)}/${record.id}`, {
					body: JSON.stringify(toBody(zone, input)),
					method: "PUT",
				}),
			);
		},
	};
}

export const linode: DnsProviderDefinition = {
	create: (credentials) => linodeClient(credentials.apiToken ?? ""),
	docsUrl:
		"https://techdocs.akamai.com/cloud-computing/docs/manage-personal-access-tokens",
	fields: [
		{
			help: "A personal access token with Domains set to Read/Write (every other scope can stay No Access).",
			key: "apiToken",
			label: "Personal access token",
			secret: true,
		},
	],
	id: "linode",
	name: "Linode (Akamai)",
};
