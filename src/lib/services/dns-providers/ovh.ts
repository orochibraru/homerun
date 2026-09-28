import { createHash } from "node:crypto";
import {
	absoluteName,
	bareTarget,
	DnsProviderError,
	normalizeName,
	providerRequest,
	relativeName,
} from "./http";
import type {
	DnsCredentials,
	DnsProviderClient,
	DnsProviderDefinition,
	DnsRecord,
	DnsRecordInput,
	DnsZone,
} from "./types";

export const OVH_ENDPOINTS: Record<string, string> = {
	"ovh-ca": "https://ca.api.ovh.com/1.0",
	"ovh-eu": "https://eu.api.ovh.com/1.0",
	"ovh-us": "https://api.us.ovhcloud.com/1.0",
};

interface OvhRecord {
	fieldType: string;
	id: number;
	subDomain: string;
	target: string;
	ttl: number;
	zone: string;
}

/** OVHcloud's `message`. */
function describe(body: unknown): string | null {
	return (body as { message?: string } | null)?.message ?? null;
}

/** An OVHcloud record in the common shape: TTL 0 means the zone default, MX targets carry their priority. */
function toRecord(record: OvhRecord, zone: DnsZone): DnsRecord {
	let content = record.target;
	let priority: number | null = null;
	if (record.fieldType === "MX") {
		const [preference = "0", ...host] = record.target.trim().split(/\s+/);
		priority = Number(preference);
		content = bareTarget(host.join(" "));
	} else if (["CNAME", "NS"].includes(record.fieldType)) {
		content = bareTarget(record.target);
	} else if (record.fieldType === "TXT") {
		content = record.target.replace(/^"([\s\S]*)"$/, "$1");
	}
	return {
		content,
		id: String(record.id),
		name: absoluteName(record.subDomain, zone),
		priority,
		ttl: record.ttl ? record.ttl : null,
		type: record.fieldType,
	};
}

/** The target OVHcloud wants: hostnames absolute with a trailing dot, MX prefixed with its priority. */
function toTarget(input: DnsRecordInput): string {
	if (input.type === "CNAME") {
		return `${bareTarget(input.content)}.`;
	}
	if (input.type === "MX") {
		return `${input.priority ?? 10} ${bareTarget(input.content)}.`;
	}
	return input.content;
}

/** The subdomain OVHcloud wants: empty for the apex. */
function subDomain(input: DnsRecordInput, zone: DnsZone): string {
	const name = relativeName(input.name, zone);
	return name === "@" ? "" : name;
}

/**
 * An OVHcloud client signing each call with `$1$` + SHA-1 of application
 * secret, consumer key, method, URL, body and a timestamp corrected by the
 * offset to the API's `/auth/time` (fetched once). Every change is followed
 * by a zone refresh, which is what makes OVHcloud publish it.
 */
class OvhClient implements DnsProviderClient {
	readonly #api: string;
	readonly #credentials: DnsCredentials;
	readonly #now: () => number;
	#offset: Promise<number> | null = null;

	/**
	 * Picks the endpoint's base URL.
	 *
	 * @throws DnsProviderError when the endpoint isn't one of ovh-eu, ovh-ca, ovh-us.
	 */
	constructor(credentials: DnsCredentials, now: () => number) {
		const api = OVH_ENDPOINTS[credentials.endpoint || "ovh-eu"];
		if (!api) {
			throw new DnsProviderError(
				400,
				`Unknown OVHcloud endpoint "${credentials.endpoint}", use ovh-eu, ovh-ca or ovh-us.`,
			);
		}
		this.#api = api;
		this.#credentials = credentials;
		this.#now = now;
	}

	/** The current Unix time as OVHcloud's clock sees it; the offset is fetched once and retried after a failure. */
	async #timestamp(): Promise<number> {
		this.#offset ??= providerRequest<number>(
			"OVHcloud",
			`${this.#api}/auth/time`,
		).then((time) => time - Math.floor(this.#now() / 1000));
		try {
			return Math.floor(this.#now() / 1000) + (await this.#offset);
		} catch (error) {
			this.#offset = null;
			throw error;
		}
	}

	/**
	 * One signed call.
	 *
	 * @throws DnsProviderError carrying OVHcloud's `message` on a non-2xx.
	 */
	async #call<T>(method: string, path: string, payload?: unknown): Promise<T> {
		const url = `${this.#api}${path}`;
		const body = payload === undefined ? "" : JSON.stringify(payload);
		const time = String(await this.#timestamp());
		const {
			applicationKey = "",
			applicationSecret = "",
			consumerKey = "",
		} = this.#credentials;
		const signature = createHash("sha1")
			.update(
				[applicationSecret, consumerKey, method, url, body, time].join("+"),
			)
			.digest("hex");
		return await providerRequest<T>(
			"OVHcloud",
			url,
			{
				body: body || undefined,
				headers: {
					"content-type": "application/json",
					"x-ovh-application": applicationKey,
					"x-ovh-consumer": consumerKey,
					"x-ovh-signature": `$1$${signature}`,
					"x-ovh-timestamp": time,
				},
				method,
			},
			describe,
		);
	}

	/** Publishes the zone's pending changes. */
	async #refresh(zone: DnsZone): Promise<void> {
		await this.#call("POST", `${zonePath(zone)}/refresh`);
	}

	/** Creates a record without refreshing. */
	async #create(zone: DnsZone, input: DnsRecordInput): Promise<DnsRecord> {
		return toRecord(
			await this.#call<OvhRecord>("POST", `${zonePath(zone)}/record`, {
				fieldType: input.type,
				subDomain: subDomain(input, zone),
				target: toTarget(input),
				ttl: input.ttl ?? 0,
			}),
			zone,
		);
	}

	/** Deletes a record without refreshing; a 404 means it's already gone. */
	async #remove(zone: DnsZone, record: DnsRecord): Promise<void> {
		try {
			await this.#call("DELETE", `${zonePath(zone)}/record/${record.id}`);
		} catch (error) {
			if (!(error instanceof DnsProviderError && error.status === 404)) {
				throw error;
			}
		}
	}

	/** Creates the record and refreshes the zone. */
	async createRecord(zone: DnsZone, input: DnsRecordInput): Promise<DnsRecord> {
		const record = await this.#create(zone, input);
		await this.#refresh(zone);
		return record;
	}

	/** Deletes the record (already gone is fine) and refreshes the zone. */
	async deleteRecord(zone: DnsZone, record: DnsRecord): Promise<void> {
		await this.#remove(zone, record);
		await this.#refresh(zone);
	}

	/** Every record in the zone: OVHcloud lists ids only, so each record is fetched on its own, in parallel. */
	async listRecords(zone: DnsZone): Promise<DnsRecord[]> {
		const ids = await this.#call<number[]>("GET", `${zonePath(zone)}/record`);
		const records = await Promise.all(
			ids.map((id) =>
				this.#call<OvhRecord>("GET", `${zonePath(zone)}/record/${id}`),
			),
		);
		return records.map((record) => toRecord(record, zone));
	}

	/** Every DNS zone on the account. */
	async listZones(): Promise<DnsZone[]> {
		return (await this.#call<string[]>("GET", "/domain/zone")).map((name) => ({
			id: name,
			name: normalizeName(name),
		}));
	}

	/** PUTs the record in place, or deletes and recreates it when the type changes (OVHcloud can't change a record's type), then refreshes. */
	async updateRecord(
		zone: DnsZone,
		record: DnsRecord,
		input: DnsRecordInput,
	): Promise<DnsRecord> {
		if (input.type !== record.type) {
			await this.#remove(zone, record);
			const created = await this.#create(zone, input);
			await this.#refresh(zone);
			return created;
		}
		const fields = {
			subDomain: subDomain(input, zone),
			target: toTarget(input),
			ttl: input.ttl ?? 0,
		};
		await this.#call("PUT", `${zonePath(zone)}/record/${record.id}`, fields);
		await this.#refresh(zone);
		return toRecord(
			{
				...fields,
				fieldType: input.type,
				id: Number(record.id),
				zone: zone.id,
			},
			zone,
		);
	}
}

/** The API path of a zone. */
function zonePath(zone: DnsZone): string {
	return `/domain/zone/${encodeURIComponent(zone.id)}`;
}

/**
 * An OVHcloud client; `now` (milliseconds) pins the local clock for tests.
 *
 * @throws DnsProviderError when the endpoint isn't one of ovh-eu, ovh-ca, ovh-us.
 */
export function ovhClient(
	credentials: DnsCredentials,
	now: () => number = Date.now,
): DnsProviderClient {
	return new OvhClient(credentials, now);
}

export const ovh: DnsProviderDefinition = {
	create: (credentials) => ovhClient(credentials),
	docsUrl:
		"https://help.ovhcloud.com/csm/en-gb-api-getting-started-ovhcloud-api",
	fields: [
		{
			help: "ovh-eu (Europe, the default), ovh-ca (Canada / Asia-Pacific) or ovh-us (OVHcloud US), matching where the account lives.",
			key: "endpoint",
			label: "API endpoint",
			optional: true,
			placeholder: "ovh-eu",
			secret: false,
		},
		{
			help: "From the endpoint's /createToken/ page (e.g. https://eu.api.ovh.com/createToken/), created with the rights GET /domain/zone, GET /domain/zone/*, POST /domain/zone/*, PUT /domain/zone/* and DELETE /domain/zone/*.",
			key: "applicationKey",
			label: "Application key",
			secret: false,
		},
		{
			help: "The application secret shown next to the application key.",
			key: "applicationSecret",
			label: "Application secret",
			secret: true,
		},
		{
			help: "The consumer key the same /createToken/ page issues for those rights.",
			key: "consumerKey",
			label: "Consumer key",
			secret: true,
		},
	],
	id: "ovh",
	name: "OVHcloud",
};
