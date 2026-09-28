import { bareTarget, DnsProviderError, normalizeName } from "./http";
import { type SigV4Credentials, signV4 } from "./sigv4";
import type {
	DnsCredentials,
	DnsProviderClient,
	DnsProviderDefinition,
	DnsRecord,
	DnsRecordInput,
	DnsZone,
} from "./types";

const API = "https://route53.amazonaws.com/2013-04-01";
const XMLNS = "https://route53.amazonaws.com/doc/2013-04-01/";
const DEFAULT_TTL = 300;

interface RecordSet {
	name: string;
	routed?: boolean;
	ttl: number | null;
	type: string;
	values: string[];
}

interface Change {
	action: "CREATE" | "DELETE" | "UPSERT";
	set: RecordSet;
}

/** Decodes the five XML entities and numeric character references. */
function unescapeXml(text: string): string {
	return text
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

/** Escapes text for an XML element body. */
function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** The raw inner XML of every `<name>` element, in document order. */
function tags(xml: string, name: string): string[] {
	return [
		...xml.matchAll(
			new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g"),
		),
	].map((match) => match[1] ?? "");
}

/** The decoded text of the first `<name>` element, null when there's none. */
function tag(xml: string, name: string): string | null {
	const inner = tags(xml, name)[0];
	return inner == null ? null : unescapeXml(inner.trim());
}

/** A Route 53 name, whose `*` and other specials come back as `\052`-style octal escapes, as a normalized name. */
function decodeName(name: string): string {
	return normalizeName(
		name.replace(/\\(\d{3})/g, (_, octal: string) =>
			String.fromCharCode(Number.parseInt(octal, 8)),
		),
	);
}

/** One rrset value in the common shape: TXT strings joined and unquoted, MX split into priority and bare host. */
function contentOf(
	type: string,
	value: string,
): { content: string; priority: number | null } {
	if (type === "TXT" || type === "SPF") {
		const strings = [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
		return {
			content: strings.length
				? strings
						.map((match) => (match[1] ?? "").replace(/\\(.)/g, "$1"))
						.join("")
				: value,
			priority: null,
		};
	}
	if (type === "MX") {
		const [priority = "0", ...host] = value.trim().split(/\s+/);
		return { content: bareTarget(host.join(" ")), priority: Number(priority) };
	}
	return {
		content: ["CNAME", "NS"].includes(type) ? bareTarget(value) : value,
		priority: null,
	};
}

/** The rrset value Route 53 wants for an input: TXT quoted in 255-character strings, MX prefixed with its priority. */
function valueOf(input: DnsRecordInput): string {
	if (input.type === "TXT") {
		const chunks = input.content.match(/[\s\S]{1,255}/g) ?? [""];
		return chunks
			.map((chunk) => `"${chunk.replace(/(["\\])/g, "\\$1")}"`)
			.join(" ");
	}
	if (input.type === "MX") {
		return `${input.priority ?? 10} ${bareTarget(input.content)}`;
	}
	return input.content;
}

/** Whether rrset value `value` is the one `record` was listed from. */
function sameValue(type: string, value: string, record: DnsRecord): boolean {
	const parsed = contentOf(type, value);
	return (
		parsed.content === record.content && parsed.priority === record.priority
	);
}

/** One rrset value as a common record, its id naming the rrset and the raw value. */
function toRecord(set: RecordSet, value: string): DnsRecord {
	return {
		...contentOf(set.type, value),
		id: `${set.type}:${set.name}:${value}`,
		name: set.name,
		ttl: set.ttl,
		type: set.type,
	};
}

/** Every `<ResourceRecordSet>` in a ListResourceRecordSets answer. */
function parseSets(xml: string): RecordSet[] {
	return tags(xml, "ResourceRecordSet").map((set) => {
		const ttl = tag(set, "TTL");
		return {
			name: decodeName(tag(set, "Name") ?? ""),
			routed: /<(SetIdentifier|AliasTarget)>/.test(set),
			ttl: ttl == null ? null : Number(ttl),
			type: tag(set, "Type") ?? "",
			values: tags(set, "Value").map((value) => unescapeXml(value.trim())),
		};
	});
}

/** An rrset as a `<Change>` element. */
function changeXml(change: Change): string {
	const { set } = change;
	const records = set.values
		.map(
			(value) =>
				`<ResourceRecord><Value>${escapeXml(value)}</Value></ResourceRecord>`,
		)
		.join("");
	return `<Change><Action>${change.action}</Action><ResourceRecordSet><Name>${escapeXml(set.name)}.</Name><Type>${set.type}</Type><TTL>${set.ttl ?? DEFAULT_TTL}</TTL><ResourceRecords>${records}</ResourceRecords></ResourceRecordSet></Change>`;
}

/** The change that takes `record`'s value out of `set`: a DELETE when it was the last one, null when it's already gone. */
function removal(set: RecordSet | null, record: DnsRecord): Change | null {
	if (!set) {
		return null;
	}
	const rest = set.values.filter(
		(value) => !sameValue(set.type, value, record),
	);
	if (rest.length === set.values.length) {
		return null;
	}
	return rest.length
		? { action: "UPSERT", set: { ...set, values: rest } }
		: { action: "DELETE", set };
}

/** The change that adds `value` to `set` for `input`: CREATE for a new rrset, UPSERT onto an existing one. */
function addition(
	set: RecordSet | null,
	input: DnsRecordInput,
	value: string,
): Change {
	return {
		action: set ? "UPSERT" : "CREATE",
		set: {
			name: normalizeName(input.name),
			ttl: input.ttl ?? set?.ttl ?? DEFAULT_TTL,
			type: input.type,
			values: [...(set?.values ?? []), value],
		},
	};
}

/**
 * A Route 53 client signing with SigV4 (us-east-1, service route53). Each
 * value of an rrset is its own record; creating, updating or deleting one
 * rewrites its rrset keeping the other values. Alias and routing-policy
 * rrsets (weighted, latency, failover...) are left out of the listing.
 */
class Route53Client implements DnsProviderClient {
	readonly #now: () => Date;
	readonly #signing: SigV4Credentials;

	/** Keeps the credentials and the clock every signature is made against. */
	constructor(credentials: DnsCredentials, now: () => Date) {
		this.#now = now;
		this.#signing = {
			accessKeyId: credentials.accessKeyId ?? "",
			region: "us-east-1",
			secretAccessKey: credentials.secretAccessKey ?? "",
			service: "route53",
			sessionToken: credentials.sessionToken || undefined,
		};
	}

	/**
	 * One signed call, returning the XML answer.
	 *
	 * @throws DnsProviderError carrying Route 53's own `<Message>` on a non-2xx.
	 */
	async #call(method: string, path: string, body = ""): Promise<string> {
		const url = `${API}${path}`;
		const headers = signV4(
			this.#signing,
			{
				body,
				headers: body ? { "content-type": "application/xml" } : {},
				method,
				url,
			},
			this.#now(),
		);
		const response = await fetch(url, {
			body: body || undefined,
			headers,
			method,
		});
		const text = await response.text();
		if (!response.ok) {
			const detail =
				tag(text, "Message") ??
				(text.trim().slice(0, 300) || response.statusText);
			throw new DnsProviderError(
				response.status,
				`Route 53 ${response.status}: ${detail}`,
			);
		}
		return text;
	}

	/** The plain (non-alias, non-routed) rrset with exactly this name and type, null when there's none. */
	async #findSet(
		zone: DnsZone,
		name: string,
		type: string,
	): Promise<RecordSet | null> {
		const host = normalizeName(name);
		const query = new URLSearchParams({
			maxitems: "1",
			name: `${host}.`,
			type,
		});
		const [set] = parseSets(
			await this.#call("GET", `/hostedzone/${zone.id}/rrset?${query}`),
		);
		return set && set.name === host && set.type === type && !set.routed
			? set
			: null;
	}

	/** Applies `changes` as one atomic ChangeResourceRecordSets batch. */
	async #change(zone: DnsZone, changes: Change[]): Promise<void> {
		await this.#call(
			"POST",
			`/hostedzone/${zone.id}/rrset/`,
			`<?xml version="1.0" encoding="UTF-8"?><ChangeResourceRecordSetsRequest xmlns="${XMLNS}"><ChangeBatch><Comment>Managed by Homerun</Comment><Changes>${changes.map(changeXml).join("")}</Changes></ChangeBatch></ChangeResourceRecordSetsRequest>`,
		);
	}

	/** Every record from the rrset page `query` starts at, following NextRecordName/Type/Identifier to the end. */
	async #records(zone: DnsZone, query: URLSearchParams): Promise<DnsRecord[]> {
		const xml = await this.#call(
			"GET",
			`/hostedzone/${zone.id}/rrset?${query}`,
		);
		const records = parseSets(xml)
			.filter((set) => !set.routed)
			.flatMap((set) => set.values.map((value) => toRecord(set, value)));
		const name = tag(xml, "NextRecordName");
		const type = tag(xml, "NextRecordType");
		const identifier = tag(xml, "NextRecordIdentifier");
		if (tag(xml, "IsTruncated") !== "true" || !name || !type) {
			return records;
		}
		const next = new URLSearchParams({
			maxitems: "300",
			name,
			type,
			...(identifier ? { identifier } : {}),
		});
		return [...records, ...(await this.#records(zone, next))];
	}

	/** Every hosted zone from `marker` on, following NextMarker to the end. */
	async #zones(marker: string): Promise<DnsZone[]> {
		const query = new URLSearchParams({
			maxitems: "100",
			...(marker ? { marker } : {}),
		});
		const xml = await this.#call("GET", `/hostedzone?${query}`);
		const zones = tags(xml, "HostedZone").map((zone) => ({
			id: (tag(zone, "Id") ?? "").replace(/^\/hostedzone\//, ""),
			name: decodeName(tag(zone, "Name") ?? ""),
		}));
		const next = tag(xml, "NextMarker");
		return tag(xml, "IsTruncated") === "true" && next
			? [...zones, ...(await this.#zones(next))]
			: zones;
	}

	/** Adds the value to its rrset, creating the rrset when it's new. */
	async createRecord(zone: DnsZone, input: DnsRecordInput): Promise<DnsRecord> {
		const value = valueOf(input);
		const next = addition(
			await this.#findSet(zone, input.name, input.type),
			input,
			value,
		);
		await this.#change(zone, [next]);
		return toRecord(next.set, value);
	}

	/** Takes the value out of its rrset, deleting the rrset when it was the last one; already gone is fine. */
	async deleteRecord(zone: DnsZone, record: DnsRecord): Promise<void> {
		const next = removal(
			await this.#findSet(zone, record.name, record.type),
			record,
		);
		if (next) {
			await this.#change(zone, [next]);
		}
	}

	/** Every plain rrset value in the zone, one record each. */
	async listRecords(zone: DnsZone): Promise<DnsRecord[]> {
		return await this.#records(zone, new URLSearchParams({ maxitems: "300" }));
	}

	/** Every hosted zone the credentials can see, public and private. */
	async listZones(): Promise<DnsZone[]> {
		return await this.#zones("");
	}

	/** Swaps the value within its rrset, or moves it to another rrset in one batch when the name or type changes. */
	async updateRecord(
		zone: DnsZone,
		record: DnsRecord,
		input: DnsRecordInput,
	): Promise<DnsRecord> {
		const value = valueOf(input);
		const old = await this.#findSet(zone, record.name, record.type);
		if (
			normalizeName(input.name) !== record.name ||
			input.type !== record.type
		) {
			const next = addition(
				await this.#findSet(zone, input.name, input.type),
				input,
				value,
			);
			const out = removal(old, record);
			await this.#change(zone, out ? [out, next] : [next]);
			return toRecord(next.set, value);
		}
		const values = (old?.values ?? []).map((current) =>
			sameValue(record.type, current, record) ? value : current,
		);
		const set: RecordSet = {
			name: record.name,
			ttl: input.ttl ?? old?.ttl ?? DEFAULT_TTL,
			type: input.type,
			values: values.includes(value) ? values : [...values, value],
		};
		await this.#change(zone, [{ action: old ? "UPSERT" : "CREATE", set }]);
		return toRecord(set, value);
	}
}

/** A Route 53 client; `now` pins the signing clock for tests. */
export function route53Client(
	credentials: DnsCredentials,
	now: () => Date = () => new Date(),
): DnsProviderClient {
	return new Route53Client(credentials, now);
}

export const route53: DnsProviderDefinition = {
	create: (credentials) => route53Client(credentials),
	docsUrl:
		"https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/access-control-managing-permissions.html",
	fields: [
		{
			help: "An IAM user's access key. Its policy needs route53:ListHostedZones, route53:ListResourceRecordSets and route53:ChangeResourceRecordSets (the latter two can be scoped to the hosted zones Homerun manages).",
			key: "accessKeyId",
			label: "Access key ID",
			placeholder: "AKIA...",
			secret: false,
		},
		{
			help: "The secret half of that access key, shown once when the key is created.",
			key: "secretAccessKey",
			label: "Secret access key",
			secret: true,
		},
		{
			help: "Only for temporary (STS) credentials. Leave empty for an IAM user's long-lived key.",
			key: "sessionToken",
			label: "Session token",
			optional: true,
			secret: true,
		},
	],
	id: "route53",
	name: "AWS Route 53",
};
