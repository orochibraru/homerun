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

const ARM = "https://management.azure.com";
const API_VERSION = "api-version=2018-05-01";
const DEFAULT_TTL = 3600;
const PROVIDER = "Azure DNS";

interface Properties {
	AAAARecords?: { ipv6Address: string }[];
	ARecords?: { ipv4Address: string }[];
	caaRecords?: { flags: number; tag: string; value: string }[];
	CNAMERecord?: { cname: string };
	MXRecords?: { exchange: string; preference: number }[];
	NSRecords?: { nsdname: string }[];
	PTRRecords?: { ptrdname: string }[];
	SOARecord?: { email: string; host: string; serialNumber: number };
	SRVRecords?: {
		port: number;
		priority: number;
		target: string;
		weight: number;
	}[];
	TTL?: number;
	TXTRecords?: { value: string[] }[];
}

interface RecordSet {
	name: string;
	properties: Properties;
	type: string;
}

interface Value {
	content: string;
	priority: number | null;
}

/** Azure's `{ error: { code, message } }` body, or the Entra token endpoint's `error_description`. */
function describe(body: unknown): string | null {
	const shaped = body as {
		error?: string | { code?: string; message?: string };
		error_description?: string;
	} | null;
	if (typeof shaped?.error === "string") {
		return shaped.error_description
			? `${shaped.error}: ${shaped.error_description.split(/\r?\n/)[0]}`
			: shaped.error;
	}
	const error = shaped?.error;
	if (!error?.message) {
		return null;
	}
	return error.code ? `${error.code}: ${error.message}` : error.message;
}

/** A record set's values in the common content/priority shape. */
function decode(type: string, properties: Properties): Value[] {
	const plain = (content: string): Value => ({ content, priority: null });
	switch (type) {
		case "A":
			return (properties.ARecords ?? []).map((r) => plain(r.ipv4Address));
		case "AAAA":
			return (properties.AAAARecords ?? []).map((r) => plain(r.ipv6Address));
		case "CNAME":
			return properties.CNAMERecord
				? [plain(bareTarget(properties.CNAMERecord.cname))]
				: [];
		case "MX":
			return (properties.MXRecords ?? []).map((r) => ({
				content: bareTarget(r.exchange),
				priority: r.preference,
			}));
		case "TXT":
			return (properties.TXTRecords ?? []).map((r) => plain(r.value.join("")));
		case "CAA":
			return (properties.caaRecords ?? []).map((r) =>
				plain(`${r.flags} ${r.tag} "${r.value}"`),
			);
		case "NS":
			return (properties.NSRecords ?? []).map((r) =>
				plain(bareTarget(r.nsdname)),
			);
		case "PTR":
			return (properties.PTRRecords ?? []).map((r) =>
				plain(bareTarget(r.ptrdname)),
			);
		case "SRV":
			return (properties.SRVRecords ?? []).map((r) => ({
				content: `${r.weight} ${r.port} ${bareTarget(r.target)}`,
				priority: r.priority,
			}));
		case "SOA":
			return properties.SOARecord
				? [
						plain(
							`${bareTarget(properties.SOARecord.host)} ${bareTarget(properties.SOARecord.email)} ${properties.SOARecord.serialNumber}`,
						),
					]
				: [];
		default:
			return [];
	}
}

/**
 * The `properties` fragment holding `values` for one of the writable types.
 *
 * @throws DnsProviderError for a CAA value that isn't `flags tag "value"`, or an unsupported type.
 */
function encode(type: string, values: Value[]): Properties {
	switch (type) {
		case "A":
			return { ARecords: values.map((v) => ({ ipv4Address: v.content })) };
		case "AAAA":
			return { AAAARecords: values.map((v) => ({ ipv6Address: v.content })) };
		case "CNAME":
			return { CNAMERecord: { cname: bareTarget(values[0]?.content ?? "") } };
		case "MX":
			return {
				MXRecords: values.map((v) => ({
					exchange: bareTarget(v.content),
					preference: v.priority ?? 10,
				})),
			};
		case "TXT":
			return {
				TXTRecords: values.map((v) => ({
					value: v.content.match(/[\s\S]{1,255}/g) ?? [""],
				})),
			};
		case "CAA":
			return {
				caaRecords: values.map((v) => {
					const match = /^\s*(\d+)\s+(\S+)\s+"?(.*?)"?\s*$/.exec(v.content);
					if (!match) {
						throw new DnsProviderError(
							400,
							`${PROVIDER}: a CAA value reads flags tag "value", not ${v.content}.`,
						);
					}
					return {
						flags: Number(match[1]),
						tag: match[2] ?? "",
						value: match[3] ?? "",
					};
				}),
			};
		default:
			throw new DnsProviderError(
				400,
				`${PROVIDER}: ${type} records can't be written.`,
			);
	}
}

/** The common record for one value of a record set, its id naming the set and the value. */
function toRecord(
	name: string,
	type: string,
	ttl: number | null,
	value: Value,
): DnsRecord {
	const host = normalizeName(name);
	return {
		content: value.content,
		id: `${type}:${host}:${value.content}`,
		name: host,
		priority: type === "MX" || type === "SRV" ? value.priority : null,
		ttl,
		type,
	};
}

/** The input's value in the common shape, MX priority defaulting to 10. */
function inputValue(input: DnsRecordInput): Value {
	const content =
		input.type === "CNAME" || input.type === "MX"
			? bareTarget(input.content)
			: input.content;
	return {
		content,
		priority: input.type === "MX" ? (input.priority ?? 10) : null,
	};
}

/** Whether two values are the same record. */
function sameValue(type: string, a: Value, b: Value): boolean {
	return (
		a.content === b.content && (type !== "MX" || a.priority === b.priority)
	);
}

export interface AzureCredentials {
	clientId: string;
	clientSecret: string;
	resourceGroup?: string;
	subscriptionId: string;
	tenantId: string;
}

interface RecordSetKey {
	name: string;
	ttl?: number | null;
	type: string;
}

/**
 * An Azure DNS client authenticated as an app registration (client
 * credentials), its access token cached until a minute before it expires.
 * Zone ids are the zones' ARM resource ids, carrying their resource group.
 * Each value of a record set is its own record; changing one rewrites the set
 * around it.
 */
export class AzureDnsClient implements DnsProviderClient {
	readonly #credentials: AzureCredentials;
	#cached: { expires: number; token: string } | null = null;

	/** Keeps the credentials; nothing is called until the first request. */
	constructor(credentials: AzureCredentials) {
		this.#credentials = credentials;
	}

	/**
	 * A bearer token for Azure Resource Manager, from the cache or a fresh
	 * client-credentials grant against the tenant.
	 *
	 * @throws DnsProviderError when Entra ID refuses the credentials.
	 */
	async #accessToken(): Promise<string> {
		if (this.#cached && this.#cached.expires > Date.now()) {
			return this.#cached.token;
		}
		const { clientId, clientSecret, tenantId } = this.#credentials;
		const body = await providerRequest<{
			access_token: string;
			expires_in: number;
		}>(
			PROVIDER,
			`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
			{
				body: new URLSearchParams({
					client_id: clientId,
					client_secret: clientSecret,
					grant_type: "client_credentials",
					scope: `${ARM}/.default`,
				}).toString(),
				headers: { "content-type": "application/x-www-form-urlencoded" },
				method: "POST",
			},
			describe,
		);
		this.#cached = {
			expires: Date.now() + (Number(body.expires_in) - 60) * 1000,
			token: body.access_token,
		};
		return body.access_token;
	}

	/** One authenticated call, to an ARM path or an absolute `nextLink`. */
	async #call<T>(url: string, init: RequestInit = {}): Promise<T> {
		const token = await this.#accessToken();
		return providerRequest<T>(
			PROVIDER,
			url.startsWith("https://") ? url : `${ARM}${url}`,
			{
				...init,
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
			},
			describe,
		);
	}

	/** Every item of a paged list, following `nextLink` to the end. */
	async #all<T>(url: string): Promise<T[]> {
		const body = await this.#call<{ nextLink?: string; value?: T[] } | null>(
			url,
		);
		const items = body?.value ?? [];
		return body?.nextLink
			? [...items, ...(await this.#all<T>(body.nextLink))]
			: items;
	}

	/** The record set's ARM path: zone id, type, relative name (`@` at the apex). */
	#setPath(zone: DnsZone, key: RecordSetKey): string {
		return `${zone.id}/${key.type}/${relativeName(key.name, zone)}?${API_VERSION}`;
	}

	/** The record set, or null when there's none. */
	async #load(zone: DnsZone, key: RecordSetKey): Promise<RecordSet | null> {
		try {
			return await this.#call<RecordSet>(this.#setPath(zone, key));
		} catch (error) {
			if (error instanceof DnsProviderError && error.status === 404) {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Rewrites one record set to `change(its values)` with a PUT, deleting it
	 * once empty. Returns the TTL written, the key's own or else the set's
	 * current one.
	 */
	async #rewrite(
		zone: DnsZone,
		key: RecordSetKey,
		change: (values: Value[]) => Value[],
	): Promise<number> {
		const current = await this.#load(zone, key);
		const values = change(current ? decode(key.type, current.properties) : []);
		const ttl = key.ttl ?? current?.properties.TTL ?? DEFAULT_TTL;
		if (values.length) {
			await this.#call(this.#setPath(zone, key), {
				body: JSON.stringify({
					properties: { TTL: ttl, ...encode(key.type, values) },
				}),
				method: "PUT",
			});
		} else if (current) {
			await this.#call(this.#setPath(zone, key), { method: "DELETE" }).catch(
				(error: unknown) => {
					if (!(error instanceof DnsProviderError && error.status === 404)) {
						throw error;
					}
				},
			);
		}
		return ttl;
	}

	/** Adds the value to its record set (replacing it for a CNAME, which holds one). */
	async createRecord(zone: DnsZone, input: DnsRecordInput): Promise<DnsRecord> {
		const value = inputValue(input);
		const ttl = await this.#rewrite(zone, input, (values) =>
			input.type === "CNAME"
				? [value]
				: [
						...values.filter((other) => !sameValue(input.type, other, value)),
						value,
					],
		);
		return toRecord(input.name, input.type, ttl, value);
	}

	/** Drops the value from its record set, deleting the set once empty; a missing one is already gone. */
	async deleteRecord(zone: DnsZone, record: DnsRecord): Promise<void> {
		await this.#rewrite(
			zone,
			{ name: record.name, type: record.type },
			(values) =>
				values.filter((value) => !sameValue(record.type, value, record)),
		);
	}

	/** Every value of every record set in the zone, one record each. */
	async listRecords(zone: DnsZone): Promise<DnsRecord[]> {
		const sets = await this.#all<RecordSet>(`${zone.id}/all?${API_VERSION}`);
		return sets.flatMap((set) => {
			const type = set.type.split("/").pop() ?? set.type;
			return decode(type, set.properties).map((value) =>
				toRecord(
					absoluteName(set.name, zone),
					type,
					set.properties.TTL ?? null,
					value,
				),
			);
		});
	}

	/** Every DNS zone in the subscription, or in the resource group when one is set. */
	async listZones(): Promise<DnsZone[]> {
		const { resourceGroup, subscriptionId } = this.#credentials;
		const scope = resourceGroup
			? `/resourceGroups/${encodeURIComponent(resourceGroup)}`
			: "";
		const zones = await this.#all<{ id: string; name: string }>(
			`/subscriptions/${encodeURIComponent(subscriptionId)}${scope}/providers/Microsoft.Network/dnszones?${API_VERSION}`,
		);
		return zones.map((zone) => ({
			id: zone.id,
			name: normalizeName(zone.name),
		}));
	}

	/** Swaps the value inside its record set, or moves it (add then remove) when the name or type changes. */
	async updateRecord(
		zone: DnsZone,
		record: DnsRecord,
		input: DnsRecordInput,
	): Promise<DnsRecord> {
		if (
			normalizeName(record.name) !== normalizeName(input.name) ||
			record.type !== input.type
		) {
			const created = await this.createRecord(zone, input);
			await this.deleteRecord(zone, record);
			return created;
		}
		const value = inputValue(input);
		const ttl = await this.#rewrite(zone, input, (values) => [
			...values.filter(
				(other) =>
					!sameValue(input.type, other, record) &&
					!sameValue(input.type, other, value),
			),
			value,
		]);
		return toRecord(input.name, input.type, ttl, value);
	}
}

export const azureDns: DnsProviderDefinition = {
	create: (credentials) =>
		new AzureDnsClient({
			clientId: credentials.clientId ?? "",
			clientSecret: credentials.clientSecret ?? "",
			resourceGroup: credentials.resourceGroup?.trim() || undefined,
			subscriptionId: credentials.subscriptionId ?? "",
			tenantId: credentials.tenantId ?? "",
		}),
	docsUrl:
		"https://learn.microsoft.com/en-us/azure/dns/dns-protect-zones-recordsets",
	fields: [
		{
			help: "Directory (tenant) ID of the app registration, from Microsoft Entra ID → App registrations → Overview.",
			key: "tenantId",
			label: "Tenant ID",
			secret: false,
		},
		{
			help: "Application (client) ID of an app registration granted the DNS Zone Contributor role on the subscription, or on the resource group holding the zones.",
			key: "clientId",
			label: "Client ID",
			secret: false,
		},
		{
			help: "A client secret of that app registration (Certificates & secrets → New client secret), its Value, not its ID.",
			key: "clientSecret",
			label: "Client secret",
			secret: true,
		},
		{
			help: "The subscription holding the DNS zones.",
			key: "subscriptionId",
			label: "Subscription ID",
			secret: false,
		},
		{
			help: "Only list the zones of this resource group, when the role is granted on the group rather than the whole subscription.",
			key: "resourceGroup",
			label: "Resource group",
			optional: true,
			secret: false,
		},
	],
	id: "azure-dns",
	name: "Azure DNS",
};
