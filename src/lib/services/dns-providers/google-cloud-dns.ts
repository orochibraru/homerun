import { importPKCS8, SignJWT } from "jose";
import {
	bareTarget,
	DnsProviderError,
	normalizeName,
	providerRequest,
} from "./http";
import type {
	DnsProviderClient,
	DnsProviderDefinition,
	DnsRecord,
	DnsRecordInput,
	DnsZone,
} from "./types";

const API = "https://dns.googleapis.com/dns/v1";
const SCOPE = "https://www.googleapis.com/auth/ndev.clouddns.readwrite";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_TTL = 300;
const PROVIDER = "Google Cloud DNS";

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
	private_key_id?: string;
	project_id?: string;
	token_uri?: string;
}

interface RecordSet {
	name: string;
	rrdatas: string[];
	ttl: number;
	type: string;
}

interface Value {
	content: string;
	priority: number | null;
}

/** Google's `{ error: { message } }` body, or the OAuth endpoint's `error_description`. */
function describe(body: unknown): string | null {
	const shaped = body as {
		error?: string | { message?: string; status?: string };
		error_description?: string;
	} | null;
	if (typeof shaped?.error === "string") {
		return shaped.error_description
			? `${shaped.error}: ${shaped.error_description}`
			: shaped.error;
	}
	const error = shaped?.error;
	if (!error?.message) {
		return null;
	}
	return error.status ? `${error.status}: ${error.message}` : error.message;
}

/** The TXT strings inside an rrdata (`"a" "b"`) joined back into one value, unescaped. */
function decodeTxt(rrdata: string): string {
	const chunks = [...rrdata.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
		(match[1] ?? "").replace(/\\(.)/g, "$1"),
	);
	return chunks.length ? chunks.join("") : rrdata;
}

/** A TXT value as quoted 255-character strings, the only form Cloud DNS accepts for long values. */
function encodeTxt(content: string): string {
	const chunks = content.match(/[\s\S]{1,255}/g) ?? [""];
	return chunks
		.map((chunk) => `"${chunk.replace(/(["\\])/g, "\\$1")}"`)
		.join(" ");
}

/** One rrdata in the common content/priority shape. */
function decode(type: string, rrdata: string): Value {
	if (type === "TXT") {
		return { content: decodeTxt(rrdata), priority: null };
	}
	if (type === "MX") {
		const [priority, host] = rrdata.trim().split(/\s+/);
		return { content: bareTarget(host ?? ""), priority: Number(priority) };
	}
	if (type === "CNAME" || type === "NS" || type === "PTR") {
		return { content: bareTarget(rrdata), priority: null };
	}
	return { content: rrdata, priority: null };
}

/** One common value as the rrdata Cloud DNS stores: absolute hostnames, quoted TXT. */
function encode(type: string, value: Value): string {
	if (type === "TXT") {
		return encodeTxt(value.content);
	}
	if (type === "MX") {
		return `${value.priority ?? 10} ${bareTarget(value.content)}.`;
	}
	if (type === "CNAME" || type === "NS" || type === "PTR") {
		return `${bareTarget(value.content)}.`;
	}
	return value.content;
}

/** The common record for one value of an rrset, its id naming the rrset and the value. */
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
		priority: type === "MX" ? value.priority : null,
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

/**
 * Parses a service account JSON key.
 *
 * @throws DnsProviderError when it isn't JSON or lacks the email or key.
 */
function parseKey(json: string): ServiceAccountKey {
	let key: Partial<ServiceAccountKey>;
	try {
		key = JSON.parse(json) as Partial<ServiceAccountKey>;
	} catch {
		throw new DnsProviderError(
			400,
			`${PROVIDER}: the service account key isn't JSON.`,
		);
	}
	if (!key.client_email || !key.private_key) {
		throw new DnsProviderError(
			400,
			`${PROVIDER}: the service account key has no client_email or private_key.`,
		);
	}
	return key as ServiceAccountKey;
}

interface RecordSetKey {
	name: string;
	ttl?: number | null;
	type: string;
}

/**
 * A Cloud DNS v1 client authenticated as a service account (a JSON key), its
 * OAuth access token cached until a minute before it expires. Each value of
 * an rrset is its own record; changing one rewrites the rrset around it.
 */
export class GoogleCloudDnsClient implements DnsProviderClient {
	readonly #keyJson: string;
	readonly #projectOverride: string | undefined;
	#cached: { expires: number; token: string } | null = null;

	/** Keeps the raw key; it's parsed on the first call, so a bad key fails that call. */
	constructor(serviceAccountJson: string, projectOverride?: string) {
		this.#keyJson = serviceAccountJson;
		this.#projectOverride = projectOverride?.trim() || undefined;
	}

	/**
	 * A bearer token for the service account, from the cache or a fresh
	 * RS256-signed JWT exchanged at Google's token endpoint.
	 *
	 * @throws DnsProviderError when the key is malformed or the exchange is refused.
	 */
	async #accessToken(): Promise<string> {
		if (this.#cached && this.#cached.expires > Date.now()) {
			return this.#cached.token;
		}
		const key = parseKey(this.#keyJson);
		const audience = key.token_uri ?? TOKEN_URL;
		const assertion = await new SignJWT({ scope: SCOPE })
			.setProtectedHeader({
				alg: "RS256",
				typ: "JWT",
				...(key.private_key_id ? { kid: key.private_key_id } : {}),
			})
			.setIssuer(key.client_email)
			.setAudience(audience)
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(await importPKCS8(key.private_key, "RS256"));
		const body = await providerRequest<{
			access_token: string;
			expires_in: number;
		}>(
			PROVIDER,
			audience,
			{
				body: new URLSearchParams({
					assertion,
					grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				}).toString(),
				headers: { "content-type": "application/x-www-form-urlencoded" },
				method: "POST",
			},
			describe,
		);
		this.#cached = {
			expires: Date.now() + (body.expires_in - 60) * 1000,
			token: body.access_token,
		};
		return body.access_token;
	}

	/**
	 * The project the zones live in: the override, else the key's `project_id`.
	 *
	 * @throws DnsProviderError when neither is set.
	 */
	#project(): string {
		const id = this.#projectOverride ?? parseKey(this.#keyJson).project_id;
		if (!id) {
			throw new DnsProviderError(
				400,
				`${PROVIDER}: no project id, set one or use a key with project_id.`,
			);
		}
		return encodeURIComponent(id);
	}

	/** One authenticated call under the project. */
	async #call<T>(path: string, init: RequestInit = {}): Promise<T> {
		const url = `${API}/projects/${this.#project()}${path}`;
		return providerRequest<T>(
			PROVIDER,
			url,
			{
				...init,
				headers: {
					authorization: `Bearer ${await this.#accessToken()}`,
					"content-type": "application/json",
				},
			},
			describe,
		);
	}

	/** Every item of a paged list, following `nextPageToken` to the end. */
	async #all<T>(path: string, field: string, pageToken?: string): Promise<T[]> {
		const query = pageToken
			? `?pageToken=${encodeURIComponent(pageToken)}`
			: "";
		const body = await this.#call<Record<string, unknown> | null>(
			`${path}${query}`,
		);
		const items = (body?.[field] as T[] | undefined) ?? [];
		const next = body?.nextPageToken as string | undefined;
		return next
			? [...items, ...(await this.#all<T>(path, field, next))]
			: items;
	}

	/** The rrset's own path: its absolute name and type. */
	#setPath(zone: DnsZone, key: RecordSetKey): string {
		return `/managedZones/${encodeURIComponent(zone.id)}/rrsets/${encodeURIComponent(`${normalizeName(key.name)}.`)}/${key.type}`;
	}

	/** The rrset, or null when there's none. */
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
	 * Rewrites one rrset to `change(its values)`: created when new, patched
	 * when it exists, deleted once empty. Returns the TTL written, the key's
	 * own or else the rrset's current one.
	 */
	async #rewrite(
		zone: DnsZone,
		key: RecordSetKey,
		change: (values: Value[]) => Value[],
	): Promise<number> {
		const current = await this.#load(zone, key);
		const values = change(
			(current?.rrdatas ?? []).map((rrdata) => decode(key.type, rrdata)),
		);
		const ttl = key.ttl ?? current?.ttl ?? DEFAULT_TTL;
		if (!values.length) {
			if (current) {
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
		const body = JSON.stringify({
			name: `${normalizeName(key.name)}.`,
			rrdatas: values.map((value) => encode(key.type, value)),
			ttl,
			type: key.type,
		});
		await (current
			? this.#call(this.#setPath(zone, key), { body, method: "PATCH" })
			: this.#call(`/managedZones/${encodeURIComponent(zone.id)}/rrsets`, {
					body,
					method: "POST",
				}));
		return ttl;
	}

	/** Adds the value to its rrset (replacing it for a CNAME, which holds one). */
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

	/** Drops the value from its rrset, deleting the rrset once empty; a missing one is already gone. */
	async deleteRecord(zone: DnsZone, record: DnsRecord): Promise<void> {
		await this.#rewrite(
			zone,
			{ name: record.name, type: record.type },
			(values) =>
				values.filter((value) => !sameValue(record.type, value, record)),
		);
	}

	/** Every value of every rrset in the zone, one record each. */
	async listRecords(zone: DnsZone): Promise<DnsRecord[]> {
		const sets = await this.#all<RecordSet>(
			`/managedZones/${encodeURIComponent(zone.id)}/rrsets`,
			"rrsets",
		);
		return sets.flatMap((set) =>
			(set.rrdatas ?? []).map((rrdata) =>
				toRecord(set.name, set.type, set.ttl ?? null, decode(set.type, rrdata)),
			),
		);
	}

	/** Every managed zone in the project, its id the zone's resource name. */
	async listZones(): Promise<DnsZone[]> {
		const zones = await this.#all<{ dnsName: string; name: string }>(
			"/managedZones",
			"managedZones",
		);
		return zones.map((zone) => ({
			id: zone.name,
			name: normalizeName(zone.dnsName),
		}));
	}

	/** Swaps the value inside its rrset, or moves it (add then remove) when the name or type changes. */
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

export const googleCloudDns: DnsProviderDefinition = {
	create: (credentials) =>
		new GoogleCloudDnsClient(
			credentials.serviceAccountKey ?? "",
			credentials.projectId,
		),
	docsUrl: "https://cloud.google.com/dns/docs/access-control",
	fields: [
		{
			help: "The whole JSON key of a service account granted the DNS Administrator role (roles/dns.admin) on the project. IAM → Service accounts → Keys → Add key → JSON.",
			key: "serviceAccountKey",
			label: "Service account JSON key",
			placeholder: '{ "type": "service_account", ... }',
			secret: true,
		},
		{
			help: "The project holding the managed zones, when it isn't the key's own project_id.",
			key: "projectId",
			label: "Project ID",
			optional: true,
			secret: false,
		},
	],
	id: "google-cloud-dns",
	name: "Google Cloud DNS",
};
