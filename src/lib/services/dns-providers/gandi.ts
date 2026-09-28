import {
	absoluteName,
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

const API = "https://api.gandi.net/v5/livedns";
const PER_PAGE = 100;

interface GandiRrset {
	rrset_name: string;
	rrset_ttl?: number;
	rrset_type: string;
	rrset_values: string[];
}

/** One zone-file RDATA value (`"quoted"` TXT, `10 mail.example.com.` MX, dotted CNAME) as the common record content and priority. */

function describe(body: unknown): string | null {
	const error = body as {
		errors?: { description?: string; name?: string }[];
		message?: string;
	} | null;
	const fields = (error?.errors ?? [])
		.map((field) => [field.name, field.description].filter(Boolean).join(": "))
		.filter(Boolean);
	return [error?.message, ...fields].filter(Boolean).join("; ") || null;
}

/** A Gandi LiveDNS v5 client authenticated with a personal access token. */
export function gandiClient(token: string): DnsProviderClient {
	const call = <T>(path: string, init: RequestInit = {}): Promise<T> =>
		providerRequest<T>(
			"Gandi",
			`${API}${path}`,
			{
				...init,
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
			},
			describe,
		);
	const all = async <T>(path: string, page = 1): Promise<T[]> => {
		const items = await call<T[]>(`${path}?per_page=${PER_PAGE}&page=${page}`);
		return items.length < PER_PAGE
			? items
			: [...items, ...(await all<T>(path, page + 1))];
	};
	const fromGandi = (rrset: GandiRrset, zone: DnsZone): Rrset => ({
		name: absoluteName(rrset.rrset_name, zone),
		ttl: rrset.rrset_ttl ?? null,
		type: rrset.rrset_type,
		values: rrset.rrset_values,
	});
	const store = (zone: DnsZone): RrsetStore => {
		const path = (name: string, type: string) =>
			`/domains/${zone.id}/records/${encodeURIComponent(relativeName(name, zone))}/${type}`;
		const body = (rrset: Rrset) => ({
			rrset_values: rrset.values,
			...(rrset.ttl != null ? { rrset_ttl: rrset.ttl } : {}),
		});
		return {
			create: (rrset) =>
				call(`/domains/${zone.id}/records`, {
					body: JSON.stringify({
						rrset_name: relativeName(rrset.name, zone),
						rrset_type: rrset.type,
						...body(rrset),
					}),
					method: "POST",
				}),
			get: async (name, type) => {
				const rrset = await orNull(call<GandiRrset>(path(name, type)));
				return rrset ? fromGandi(rrset, zone) : null;
			},
			remove: (name, type) => call(path(name, type), { method: "DELETE" }),
			replace: (rrset) =>
				call(path(rrset.name, rrset.type), {
					body: JSON.stringify(body(rrset)),
					method: "PUT",
				}),
		};
	};
	return {
		createRecord: (zone, input) =>
			rrsetEditor(store(zone)).createRecord(zone, input),
		deleteRecord: (zone, record) =>
			rrsetEditor(store(zone)).deleteRecord(zone, record),
		async listRecords(zone: DnsZone) {
			return (await all<GandiRrset>(`/domains/${zone.id}/records`)).flatMap(
				(rrset) => rrsetRecords(fromGandi(rrset, zone)),
			);
		},
		async listZones() {
			return (await all<{ fqdn: string }>("/domains")).map((domain) => ({
				id: normalizeName(domain.fqdn),
				name: normalizeName(domain.fqdn),
			}));
		},
		updateRecord: (zone, record, input) =>
			rrsetEditor(store(zone)).updateRecord(zone, record, input),
	};
}

export const gandi: DnsProviderDefinition = {
	create: (credentials) => gandiClient(credentials.token ?? ""),
	docsUrl:
		"https://docs.gandi.net/en/managing_an_organization/organizations/personal_access_token.html",
	fields: [
		{
			help: 'A personal access token (Account → Authentication options → Personal access tokens), scoped to the organization owning the domains, with the Domains → "Manage domain name technical configurations" permission. Only domains on Gandi LiveDNS show up.',
			key: "token",
			label: "Personal access token",
			secret: true,
		},
	],
	id: "gandi",
	name: "Gandi LiveDNS",
};
