import {
	DnsProviderError,
	normalizeName,
	providerRequest,
	relativeName,
} from "./http";
import {
	orNull,
	type Rrset,
	type RrsetStore,
	rrsetEditor,
	rrsetRecords,
} from "./rrset";
import type {
	DnsProviderClient,
	DnsProviderDefinition,
	DnsZone,
} from "./types";

const API = "https://desec.io/api/v1";
const DEFAULT_TTL = 3600;

interface DesecRrset {
	name: string;
	records: string[];
	subname: string;
	ttl: number;
	type: string;
}

/** deSEC's `detail`, or its per-field error lists flattened to `field: message`. */
function describe(body: unknown): string | null {
	const items = Array.isArray(body) ? body : [body];
	const messages = items.flatMap((item) => {
		if (!item || typeof item !== "object") {
			return typeof item === "string" ? [item] : [];
		}
		const { detail, ...fields } = item as Record<string, unknown>;
		if (typeof detail === "string") {
			return [detail];
		}
		return Object.entries(fields).map(([field, value]) => {
			const text = Array.isArray(value) ? value.join(" ") : String(value);
			return field === "non_field_errors" ? text : `${field}: ${text}`;
		});
	});
	return messages.length ? messages.join("; ") : null;
}

/** A deSEC rrset in the shared shape. */
function fromDesec(rrset: DesecRrset): Rrset {
	return {
		name: rrset.name,
		ttl: rrset.ttl,
		type: rrset.type,
		values: rrset.records,
	};
}

/** A deSEC client authenticated with an API token. */
export function desecClient(token: string): DnsProviderClient {
	const headers = {
		authorization: `Token ${token}`,
		"content-type": "application/json",
	};
	const call = <T>(path: string, init: RequestInit = {}): Promise<T> =>
		providerRequest<T>(
			"deSEC",
			`${API}${path}`,
			{ ...init, headers },
			describe,
		);
	const all = async <T>(url: string): Promise<T[]> => {
		const response = await fetch(url, { headers });
		const raw = await response.text();
		if (!response.ok) {
			let detail: string | null = null;
			try {
				detail = describe(JSON.parse(raw));
			} catch {
				detail = null;
			}
			throw new DnsProviderError(
				response.status,
				`deSEC ${response.status}: ${detail ?? (raw.trim().slice(0, 300) || response.statusText)}`,
			);
		}
		const next = response.headers
			.get("link")
			?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
		const items = JSON.parse(raw) as T[];
		return next ? [...items, ...(await all<T>(next))] : items;
	};
	const store = (zone: DnsZone): RrsetStore => {
		const path = (name: string, type: string) =>
			`/domains/${zone.id}/rrsets/${encodeURIComponent(relativeName(name, zone))}/${type}/`;
		return {
			create: (rrset) => {
				const subname = relativeName(rrset.name, zone);
				return call(`/domains/${zone.id}/rrsets/`, {
					body: JSON.stringify({
						records: rrset.values,
						subname: subname === "@" ? "" : subname,
						ttl: rrset.ttl ?? DEFAULT_TTL,
						type: rrset.type,
					}),
					method: "POST",
				});
			},
			get: async (name, type) => {
				const rrset = await orNull(call<DesecRrset>(path(name, type)));
				return rrset ? fromDesec(rrset) : null;
			},
			remove: (name, type) => call(path(name, type), { method: "DELETE" }),
			replace: (rrset) =>
				call(path(rrset.name, rrset.type), {
					body: JSON.stringify({
						records: rrset.values,
						...(rrset.ttl != null ? { ttl: rrset.ttl } : {}),
					}),
					method: "PATCH",
				}),
		};
	};
	return {
		createRecord: async (zone, input) => {
			const record = await rrsetEditor(store(zone)).createRecord(zone, input);
			return { ...record, ttl: record.ttl ?? DEFAULT_TTL };
		},
		deleteRecord: (zone, record) =>
			rrsetEditor(store(zone)).deleteRecord(zone, record),
		async listRecords(zone: DnsZone) {
			return (
				await all<DesecRrset>(`${API}/domains/${zone.id}/rrsets/?cursor=`)
			).flatMap((rrset) => rrsetRecords(fromDesec(rrset)));
		},
		async listZones() {
			return (await all<{ name: string }>(`${API}/domains/?cursor=`)).map(
				(domain) => ({
					id: normalizeName(domain.name),
					name: normalizeName(domain.name),
				}),
			);
		},
		updateRecord: (zone, record, input) =>
			rrsetEditor(store(zone)).updateRecord(zone, record, input),
	};
}

export const desec: DnsProviderDefinition = {
	create: (credentials) => desecClient(credentials.token ?? ""),
	docsUrl: "https://desec.readthedocs.io/en/latest/auth/tokens.html",
	fields: [
		{
			help: "A token from deSEC's Token Management page. A plain token can manage every domain in the account; if you attach scoping policies, allow write access to the domains Homerun manages.",
			key: "token",
			label: "API token",
			secret: true,
		},
	],
	id: "desec",
	name: "deSEC",
};
