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

const API = "https://api.porkbun.com/api/json/v3";

interface Envelope {
	message?: string;
	status: string;
}

interface PorkbunRecord {
	content: string;
	id: string;
	name: string;
	prio?: string | number | null;
	ttl?: string | number | null;
	type: string;
}

interface PorkbunDomain {
	apiAccess?: number | string;
	domain: string;
}

/** Porkbun's `message`. */
function describe(body: unknown): string | null {
	return (body as Envelope | null)?.message ?? null;
}

/** A Porkbun record in the common shape. */
function toRecord(record: PorkbunRecord, zone: DnsZone): DnsRecord {
	const bare = ["CNAME", "MX", "NS", "ALIAS"].includes(record.type);
	return {
		content: bare ? bareTarget(record.content) : record.content,
		id: String(record.id),
		name: absoluteName(record.name, zone),
		priority: record.type === "MX" ? Number(record.prio ?? 0) : null,
		ttl: record.ttl == null || record.ttl === "" ? null : Number(record.ttl),
		type: record.type,
	};
}

/** The fields Porkbun wants for a record: the subdomain (empty for the apex), string TTL and priority. */
function toBody(zone: DnsZone, input: DnsRecordInput): Record<string, string> {
	const name = relativeName(input.name, zone);
	return {
		content: ["CNAME", "MX"].includes(input.type)
			? bareTarget(input.content)
			: input.content,
		name: name === "@" ? "" : name,
		type: input.type,
		...(input.ttl != null ? { ttl: String(input.ttl) } : {}),
		...(input.priority != null ? { prio: String(input.priority) } : {}),
	};
}

/** A Porkbun v3 client authenticated with an API key pair, each call a POST carrying the keys in its JSON body. */
export function porkbunClient(
	apiKey: string,
	secretApiKey: string,
): DnsProviderClient {
	const call = async <T extends Envelope>(
		path: string,
		fields: Record<string, unknown> = {},
	): Promise<T> => {
		const body = await providerRequest<T>(
			"Porkbun",
			`${API}${path}`,
			{
				body: JSON.stringify({
					apikey: apiKey,
					secretapikey: secretApiKey,
					...fields,
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			},
			describe,
		);
		if (body?.status !== "SUCCESS") {
			throw new DnsProviderError(
				200,
				`Porkbun: ${describe(body) ?? "request failed"}`,
			);
		}
		return body;
	};
	const domains = async (start = 0): Promise<PorkbunDomain[]> => {
		const page =
			(
				await call<Envelope & { domains?: PorkbunDomain[] }>(
					"/domain/listAll",
					{ start: String(start) },
				)
			).domains ?? [];
		return page.length
			? [...page, ...(await domains(start + page.length))]
			: page;
	};
	return {
		async createRecord(zone: DnsZone, input: DnsRecordInput) {
			const body = await call<Envelope & { id: string | number }>(
				`/dns/create/${zone.id}`,
				toBody(zone, input),
			);
			return toRecord(
				{
					content: input.content,
					id: String(body.id),
					name: input.name,
					prio: input.priority,
					ttl: input.ttl,
					type: input.type,
				},
				zone,
			);
		},
		async deleteRecord(zone: DnsZone, record: DnsRecord) {
			try {
				await call(`/dns/delete/${zone.id}/${record.id}`);
			} catch (error) {
				if (!(error instanceof DnsProviderError && error.status === 404)) {
					throw error;
				}
			}
		},
		async listRecords(zone: DnsZone) {
			const body = await call<Envelope & { records?: PorkbunRecord[] }>(
				`/dns/retrieve/${zone.id}`,
			);
			return (body.records ?? []).map((record) => toRecord(record, zone));
		},
		async listZones() {
			return (await domains())
				.filter((domain) => Number(domain.apiAccess ?? 1) === 1)
				.map((domain) => ({
					id: normalizeName(domain.domain),
					name: normalizeName(domain.domain),
				}));
		},
		async updateRecord(
			zone: DnsZone,
			record: DnsRecord,
			input: DnsRecordInput,
		) {
			await call(`/dns/edit/${zone.id}/${record.id}`, toBody(zone, input));
			return toRecord(
				{
					content: input.content,
					id: record.id,
					name: input.name,
					prio: input.priority,
					ttl: input.ttl,
					type: input.type,
				},
				zone,
			);
		},
	};
}

export const porkbun: DnsProviderDefinition = {
	create: (credentials) =>
		porkbunClient(credentials.apiKey ?? "", credentials.secretApiKey ?? ""),
	docsUrl:
		"https://kb.porkbun.com/article/190-getting-started-with-the-porkbun-api",
	fields: [
		{
			help: "From porkbun.com → Account → API Access. Then turn on \"API Access\" on each domain Homerun should manage (Domain Management → the domain's Details), or it won't be listed.",
			key: "apiKey",
			label: "API key",
			placeholder: "pk1_…",
			secret: false,
		},
		{
			help: "The secret key shown once next to the API key when you create it.",
			key: "secretApiKey",
			label: "Secret API key",
			placeholder: "sk1_…",
			secret: true,
		},
	],
	id: "porkbun",
	name: "Porkbun",
};
