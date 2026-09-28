import { DnsProviderError, normalizeName, providerRequest } from "./http";
import type {
	DnsProviderClient,
	DnsProviderDefinition,
	DnsRecord,
	DnsRecordInput,
	DnsZone,
} from "./types";

const API = "https://api.cloudflare.com/client/v4";

export const MANAGED_COMMENT = "Managed by Homerun";

interface Envelope<T> {
	errors?: { code: number; message: string }[];
	result: T;
	result_info?: { page: number; total_pages: number };
	success: boolean;
}

interface CloudflareRecord {
	content: string;
	id: string;
	name: string;
	priority?: number;
	ttl: number;
	type: string;
}

/** Cloudflare's `errors[]` as `[code] message` pairs. */
function describe(body: unknown): string | null {
	const errors = (body as Envelope<unknown> | null)?.errors;
	return errors?.length
		? errors.map((error) => `[${error.code}] ${error.message}`).join("; ")
		: null;
}

/** A Cloudflare record in the common shape. */
function toRecord(record: CloudflareRecord): DnsRecord {
	return {
		content: record.content,
		id: record.id,
		name: normalizeName(record.name),
		priority: record.priority ?? null,
		ttl: record.ttl === 1 ? null : record.ttl,
		type: record.type,
	};
}

/** The body Cloudflare wants for a record: full name, TTL 1 meaning automatic. */
function toBody(
	input: DnsRecordInput,
	comment: boolean,
): Record<string, unknown> {
	return {
		content: input.content,
		name: normalizeName(input.name),
		ttl: input.ttl ?? 1,
		type: input.type,
		...(input.priority != null ? { priority: input.priority } : {}),
		...(comment ? { comment: MANAGED_COMMENT } : {}),
	};
}

/** A Cloudflare v4 client authenticated with an API token scoped to Zone:Read and DNS:Edit. */
export function cloudflareClient(apiToken: string): DnsProviderClient {
	const call = async <T>(
		path: string,
		init: RequestInit = {},
	): Promise<Envelope<T>> => {
		const body = await providerRequest<Envelope<T>>(
			"Cloudflare",
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
		if (!body?.success) {
			throw new DnsProviderError(
				200,
				`Cloudflare: ${describe(body) ?? "request failed"}`,
			);
		}
		return body;
	};
	const all = async <T>(path: string, page = 1): Promise<T[]> => {
		const separator = path.includes("?") ? "&" : "?";
		const body = await call<T[]>(
			`${path}${separator}per_page=100&page=${page}`,
		);
		const more = (body.result_info?.total_pages ?? 1) > page;
		return more
			? [...body.result, ...(await all<T>(path, page + 1))]
			: body.result;
	};
	return {
		async createRecord(zone: DnsZone, input: DnsRecordInput) {
			const body = await call<CloudflareRecord>(
				`/zones/${zone.id}/dns_records`,
				{
					body: JSON.stringify(toBody(input, true)),
					method: "POST",
				},
			);
			return toRecord(body.result);
		},
		async deleteRecord(zone: DnsZone, record: DnsRecord) {
			try {
				await call(`/zones/${zone.id}/dns_records/${record.id}`, {
					method: "DELETE",
				});
			} catch (error) {
				if (!(error instanceof DnsProviderError && error.status === 404)) {
					throw error;
				}
			}
		},
		async listRecords(zone: DnsZone) {
			return (await all<CloudflareRecord>(`/zones/${zone.id}/dns_records`)).map(
				toRecord,
			);
		},
		async listZones() {
			return (await all<{ id: string; name: string }>("/zones")).map(
				(zone) => ({
					id: zone.id,
					name: normalizeName(zone.name),
				}),
			);
		},
		async updateRecord(
			zone: DnsZone,
			record: DnsRecord,
			input: DnsRecordInput,
		) {
			const body = await call<CloudflareRecord>(
				`/zones/${zone.id}/dns_records/${record.id}`,
				{ body: JSON.stringify(toBody(input, false)), method: "PATCH" },
			);
			return toRecord(body.result);
		},
	};
}

export const cloudflare: DnsProviderDefinition = {
	create: (credentials) => cloudflareClient(credentials.apiToken ?? ""),
	docsUrl:
		"https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
	fields: [
		{
			help: "A token with Zone → Zone → Read and Zone → DNS → Edit, for all zones or the ones Homerun manages.",
			key: "apiToken",
			label: "API token",
			secret: true,
		},
	],
	id: "cloudflare",
	name: "Cloudflare",
};
