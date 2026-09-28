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

const API = "https://api.hetzner.cloud/v1";

interface Page {
	meta?: { pagination?: { next_page: number | null } };
}

interface HetznerRRSet {
	name: string;
	records: { value: string }[];
	ttl: number | null;
	type: string;
}

/** Hetzner's `{ error: { message } }` body. */
function describe(body: unknown): string | null {
	return (
		(body as { error?: { message?: string } } | null)?.error?.message ?? null
	);
}

/** A zone-file TXT value (`"a" "b"`) as one plain string. */
function unquote(value: string): string {
	const text = value.trim();
	return text.startsWith('"') && text.endsWith('"')
		? text.slice(1, -1).replace(/"\s+"/g, "").replace(/\\(.)/g, "$1")
		: text;
}

/** A plain TXT string as the quoted, 255-character-chunked value Hetzner wants. */
function quote(value: string): string {
	return (value.match(/[\s\S]{1,255}/g) ?? [""])
		.map((chunk) => `"${chunk.replace(/(["\\])/g, "\\$1")}"`)
		.join(" ");
}

/** The zone-file value Hetzner stores for a record. */
function toValue(input: DnsRecordInput): string {
	switch (input.type) {
		case "CNAME":
			return `${bareTarget(input.content)}.`;
		case "MX":
			return `${input.priority ?? 10} ${bareTarget(input.content)}.`;
		case "TXT":
			return quote(input.content);
		default:
			return input.content.trim();
	}
}

/** One value of a Hetzner RRSet in the common shape, its id `name/type/value` so it can be removed later. */
function toRecord(
	zone: DnsZone,
	rrset: HetznerRRSet,
	value: string,
): DnsRecord {
	const base = {
		id: `${rrset.name}/${rrset.type}/${value}`,
		name: absoluteName(rrset.name, zone),
		ttl: rrset.ttl,
		type: rrset.type,
	};
	if (rrset.type === "MX") {
		const [priority = "", ...target] = value.trim().split(/\s+/);
		return {
			...base,
			content: bareTarget(target.join(" ")),
			priority: Number(priority),
		};
	}
	const content =
		rrset.type === "TXT"
			? unquote(value)
			: rrset.type === "CNAME" || rrset.type === "NS"
				? bareTarget(value)
				: value;
	return { ...base, content, priority: null };
}

/** The RRSet name, type and raw value a record id points at. */
function parseId(id: string): { name: string; type: string; value: string } {
	const [name = "", type = "", ...value] = id.split("/");
	return { name, type, value: value.join("/") };
}

/** A Hetzner Cloud DNS client authenticated with a project API token with Read & Write permission. */
export function hetznerClient(apiToken: string): DnsProviderClient {
	const call = <T>(path: string, init: RequestInit = {}): Promise<T> =>
		providerRequest<T>(
			"Hetzner",
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
			`${path}?page=${page}&per_page=50`,
		);
		const items = (body[key] as T[] | undefined) ?? [];
		return body.meta?.pagination?.next_page
			? [...items, ...(await all<T>(path, key, page + 1))]
			: items;
	};
	const action = (
		rrset: { name: string; type: string; zone: DnsZone },
		verb: string,
		payload: Record<string, unknown>,
	) =>
		call(
			`/zones/${rrset.zone.id}/rrsets/${rrset.name}/${rrset.type}/actions/${verb}`,
			{
				body: JSON.stringify(payload),
				method: "POST",
			},
		);
	const add = async (
		zone: DnsZone,
		input: DnsRecordInput,
	): Promise<DnsRecord> => {
		const name = relativeName(input.name, zone);
		const value = toValue(input);
		await action({ name, type: input.type, zone }, "add_records", {
			records: [{ value }],
			...(input.ttl != null ? { ttl: input.ttl } : {}),
		});
		return toRecord(
			zone,
			{ name, records: [], ttl: input.ttl ?? null, type: input.type },
			value,
		);
	};
	return {
		createRecord: add,
		async deleteRecord(zone: DnsZone, record: DnsRecord) {
			const { name, type, value } = parseId(record.id);
			try {
				await action({ name, type, zone }, "remove_records", {
					records: [{ value }],
				});
			} catch (error) {
				if (!(error instanceof DnsProviderError && error.status === 404)) {
					throw error;
				}
			}
		},
		async listRecords(zone: DnsZone) {
			const rrsets = await all<HetznerRRSet>(
				`/zones/${zone.id}/rrsets`,
				"rrsets",
			);
			return rrsets.flatMap((rrset) =>
				rrset.records.map((entry) => toRecord(zone, rrset, entry.value)),
			);
		},
		async listZones() {
			return (await all<{ id: number; name: string }>("/zones", "zones")).map(
				(zone) => ({ id: String(zone.id), name: normalizeName(zone.name) }),
			);
		},
		async updateRecord(
			zone: DnsZone,
			record: DnsRecord,
			input: DnsRecordInput,
		) {
			const old = parseId(record.id);
			const name = relativeName(input.name, zone);
			const value = toValue(input);
			if (old.name === name && old.type === input.type && old.value === value) {
				await action({ name, type: input.type, zone }, "change_ttl", {
					ttl: input.ttl ?? null,
				});
				return toRecord(
					zone,
					{ name, records: [], ttl: input.ttl ?? null, type: input.type },
					value,
				);
			}
			await action({ ...old, zone }, "remove_records", {
				records: [{ value: old.value }],
			});
			return add(zone, input);
		},
	};
}

export const hetzner: DnsProviderDefinition = {
	create: (credentials) => hetznerClient(credentials.apiToken ?? ""),
	docsUrl:
		"https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/",
	fields: [
		{
			help: "A Hetzner Console API token with Read & Write permission, created in the project that holds your DNS zones (Security → API tokens).",
			key: "apiToken",
			label: "API token",
			secret: true,
		},
	],
	id: "hetzner",
	name: "Hetzner",
};
