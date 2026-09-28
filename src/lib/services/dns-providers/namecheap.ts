import {
	absoluteName,
	bareTarget,
	DnsProviderError,
	normalizeName,
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

const API = "https://api.namecheap.com/xml.response";
const PAGE_SIZE = 100;
const AUTOMATIC_TTL = "1799";

interface Host {
	Address: string;
	MXPref: string;
	Name: string;
	TTL: string;
	Type: string;
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

/** The attributes of every `<name ...>` element, decoded. */
function elements(xml: string, name: string): Record<string, string>[] {
	return [...xml.matchAll(new RegExp(`<${name}\\s([^>]*?)/?>`, "g"))].map(
		(element) =>
			Object.fromEntries(
				[...(element[1] ?? "").matchAll(/([\w:]+)="([^"]*)"/g)].map(
					(attribute) => [attribute[1], unescapeXml(attribute[2] ?? "")],
				),
			),
	);
}

/** A Namecheap host in the common shape; TTL 1799 is what the dashboard calls Automatic. */
function toRecord(host: Host, zone: DnsZone): DnsRecord {
	const name = absoluteName(host.Name, zone);
	const content = ["CNAME", "MX", "NS", "ALIAS"].includes(host.Type)
		? bareTarget(host.Address)
		: host.Type === "TXT"
			? host.Address.replace(/^"([\s\S]*)"$/, "$1")
			: host.Address;
	const priority = host.Type === "MX" ? Number(host.MXPref || 0) : null;
	return {
		content,
		id: `${host.Type}:${name}:${priority ?? ""}:${content}`,
		name,
		priority,
		ttl: !host.TTL || host.TTL === AUTOMATIC_TTL ? null : Number(host.TTL),
		type: host.Type,
	};
}

/** The host entry Namecheap wants for an input. */
function toHost(input: DnsRecordInput, zone: DnsZone): Host {
	return {
		Address: ["CNAME", "MX"].includes(input.type)
			? bareTarget(input.content)
			: input.content,
		MXPref: String(input.type === "MX" ? (input.priority ?? 10) : 10),
		Name: relativeName(input.name, zone),
		TTL: input.ttl == null ? AUTOMATIC_TTL : String(input.ttl),
		Type: input.type,
	};
}

/** A zone's SLD (first label) and TLD (the rest, `co.uk` included). */
function domain(zone: DnsZone): { SLD: string; TLD: string } {
	const name = normalizeName(zone.name);
	const dot = name.indexOf(".");
	return { SLD: name.slice(0, dot), TLD: name.slice(dot + 1) };
}

/** Namecheap's `<Error>`s from a `Status="ERROR"` answer, null when the answer is OK. */
function apiErrors(xml: string): string | null {
	if (!/<ApiResponse[^>]*Status="ERROR"/.test(xml)) {
		return null;
	}
	const errors = [
		...xml.matchAll(/<Error\s[^>]*Number="(\d+)"[^>]*>([\s\S]*?)<\/Error>/g),
	].map((error) => `[${error[1]}] ${unescapeXml((error[2] ?? "").trim())}`);
	return errors.join("; ") || "request failed";
}

/**
 * A Namecheap client. Namecheap has no per-record calls: `setHosts` replaces
 * a domain's whole host list, so every change reads the current list,
 * edits it and writes all of it back. A domain is split into SLD (its first
 * label) and TLD (the rest), which holds since zones only come from the
 * account's registered domains.
 */
class NamecheapClient implements DnsProviderClient {
	readonly #auth: Record<string, string>;

	/** Keeps the parameters every call carries; the username defaults to the API user. */
	constructor(credentials: DnsCredentials) {
		this.#auth = {
			ApiKey: credentials.apiKey ?? "",
			ApiUser: credentials.apiUser ?? "",
			ClientIp: credentials.clientIp ?? "",
			UserName: credentials.userName || credentials.apiUser || "",
		};
	}

	/**
	 * One API command, GET with a query string or POST as a form, returning the XML answer.
	 *
	 * @throws DnsProviderError on a non-2xx, or with Namecheap's own `[number] message` when the answer's status is ERROR.
	 */
	async #call(
		command: string,
		params: Record<string, string>,
		post = false,
	): Promise<string> {
		const query = new URLSearchParams({
			...this.#auth,
			Command: command,
			...params,
		});
		const response = post
			? await fetch(API, {
					body: query.toString(),
					headers: { "content-type": "application/x-www-form-urlencoded" },
					method: "POST",
				})
			: await fetch(`${API}?${query}`);
		const text = await response.text();
		if (!response.ok) {
			throw new DnsProviderError(
				response.status,
				`Namecheap ${response.status}: ${text.trim().slice(0, 300) || response.statusText}`,
			);
		}
		const errors = apiErrors(text);
		if (errors) {
			throw new DnsProviderError(response.status, `Namecheap: ${errors}`);
		}
		return text;
	}

	/** The domain's host list and its email type. */
	async #read(
		zone: DnsZone,
	): Promise<{ emailType: string | null; hosts: Host[] }> {
		const xml = await this.#call(
			"namecheap.domains.dns.getHosts",
			domain(zone),
		);
		const hosts = elements(xml, "host").map((host) => ({
			Address: host.Address ?? "",
			MXPref: host.MXPref ?? "10",
			Name: host.Name ?? "@",
			TTL: host.TTL ?? AUTOMATIC_TTL,
			Type: host.Type ?? "",
		}));
		const emailType =
			elements(xml, "DomainDNSGetHostsResult")[0]?.EmailType ?? null;
		return { emailType, hosts };
	}

	/**
	 * Replaces the domain's whole host list; EmailType becomes MX whenever an
	 * MX host is present (Namecheap ignores MX hosts otherwise), else stays what it was.
	 *
	 * @throws DnsProviderError when Namecheap doesn't report IsSuccess.
	 */
	async #write(
		zone: DnsZone,
		hosts: Host[],
		emailType: string | null,
	): Promise<void> {
		const params: Record<string, string> = domain(zone);
		hosts.forEach((host, index) => {
			params[`HostName${index + 1}`] = host.Name;
			params[`RecordType${index + 1}`] = host.Type;
			params[`Address${index + 1}`] = host.Address;
			params[`MXPref${index + 1}`] = host.MXPref;
			params[`TTL${index + 1}`] = host.TTL;
		});
		const email = hosts.some((host) => host.Type === "MX") ? "MX" : emailType;
		if (email) {
			params.EmailType = email;
		}
		const xml = await this.#call(
			"namecheap.domains.dns.setHosts",
			params,
			true,
		);
		if (elements(xml, "DomainDNSSetHostsResult")[0]?.IsSuccess !== "true") {
			throw new DnsProviderError(200, "Namecheap: setHosts didn't succeed");
		}
	}

	/** Every domain from `page` on that uses Namecheap's DNS. */
	async #domains(page: number): Promise<DnsZone[]> {
		const xml = await this.#call("namecheap.domains.getList", {
			ListType: "ALL",
			Page: String(page),
			PageSize: String(PAGE_SIZE),
		});
		const zones = elements(xml, "Domain")
			.filter((entry) => entry.Name && entry.IsOurDNS !== "false")
			.map((entry) => ({
				id: entry.Name ?? "",
				name: normalizeName(entry.Name ?? ""),
			}));
		const total = Number(/<TotalItems>(\d+)<\/TotalItems>/.exec(xml)?.[1] ?? 0);
		return page * PAGE_SIZE < total
			? [...zones, ...(await this.#domains(page + 1))]
			: zones;
	}

	/** Appends the host and writes the list back. */
	async createRecord(zone: DnsZone, input: DnsRecordInput): Promise<DnsRecord> {
		const { emailType, hosts } = await this.#read(zone);
		const host = toHost(input, zone);
		await this.#write(zone, [...hosts, host], emailType);
		return toRecord(host, zone);
	}

	/** Writes the list back without the host; already gone is fine. */
	async deleteRecord(zone: DnsZone, record: DnsRecord): Promise<void> {
		const { emailType, hosts } = await this.#read(zone);
		const rest = hosts.filter((host) => toRecord(host, zone).id !== record.id);
		if (rest.length !== hosts.length) {
			await this.#write(zone, rest, emailType);
		}
	}

	/** Every host on the domain. */
	async listRecords(zone: DnsZone): Promise<DnsRecord[]> {
		return (await this.#read(zone)).hosts.map((host) => toRecord(host, zone));
	}

	/** Every domain on the account that uses Namecheap's DNS. */
	async listZones(): Promise<DnsZone[]> {
		return await this.#domains(1);
	}

	/** Replaces the host in place (appending it when it's gone) and writes the list back. */
	async updateRecord(
		zone: DnsZone,
		record: DnsRecord,
		input: DnsRecordInput,
	): Promise<DnsRecord> {
		const { emailType, hosts } = await this.#read(zone);
		const host = toHost(input, zone);
		const found = hosts.some((entry) => toRecord(entry, zone).id === record.id);
		await this.#write(
			zone,
			found
				? hosts.map((entry) =>
						toRecord(entry, zone).id === record.id ? host : entry,
					)
				: [...hosts, host],
			emailType,
		);
		return toRecord(host, zone);
	}
}

/** A Namecheap client for these credentials. */
export function namecheapClient(
	credentials: DnsCredentials,
): DnsProviderClient {
	return new NamecheapClient(credentials);
}

export const namecheap: DnsProviderDefinition = {
	create: (credentials) => namecheapClient(credentials),
	docsUrl: "https://www.namecheap.com/support/api/intro/",
	fields: [
		{
			help: "Your Namecheap username. API access must be enabled under Profile → Tools → Namecheap API Access (Namecheap requires a qualifying account: 20+ domains, $50+ balance or $50+ spent in the last two years).",
			key: "apiUser",
			label: "API user",
			secret: false,
		},
		{
			help: "The API key shown on that Namecheap API Access page once access is on.",
			key: "apiKey",
			label: "API key",
			secret: true,
		},
		{
			help: "The public IPv4 address this Homerun server calls out from. It must be added to the Whitelisted IPs on the Namecheap API Access page, or every call is refused.",
			key: "clientIp",
			label: "Whitelisted client IP",
			placeholder: "203.0.113.10",
			secret: false,
		},
		{
			help: "The account the domains belong to, when it differs from the API user (resellers). Defaults to the API user.",
			key: "userName",
			label: "Username",
			optional: true,
			secret: false,
		},
	],
	id: "namecheap",
	name: "Namecheap",
};
