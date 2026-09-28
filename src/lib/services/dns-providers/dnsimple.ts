import {
	absoluteName,
	bareTarget,
	DnsProviderError,
	normalizeName,
	providerRequest,
	relativeName,
} from "./http";
import { fromRrsetValue } from "./rrset";
import type {
	DnsProviderClient,
	DnsProviderDefinition,
	DnsRecord,
	DnsRecordInput,
	DnsZone,
} from "./types";

const API = "https://api.dnsimple.com/v2";

interface Page<T> {
	data: T;
	pagination?: { current_page: number; total_pages: number };
}

interface DnsimpleRecord {
	content: string;
	id: number;
	name: string;
	priority: number | null;
	ttl: number;
	type: string;
}

/** DNSimple's `message`, plus each field's validation errors. */
function describe(body: unknown): string | null {
	const error = body as {
		errors?: Record<string, string[] | string>;
		message?: string;
	} | null;
	const fields = Object.entries(error?.errors ?? {}).map(
		([field, messages]) =>
			`${field} ${Array.isArray(messages) ? messages.join(", ") : messages}`,
	);
	return [error?.message, ...fields].filter(Boolean).join("; ") || null;
}

/** A DNSimple record in the common shape. */
function toRecord(record: DnsimpleRecord, zone: DnsZone): DnsRecord {
	const content = ["CNAME", "MX", "NS", "ALIAS"].includes(record.type)
		? bareTarget(record.content)
		: record.type === "TXT" && record.content.startsWith('"')
			? fromRrsetValue("TXT", record.content).content
			: record.content;
	return {
		content,
		id: String(record.id),
		name: absoluteName(record.name, zone),
		priority: record.type === "MX" ? record.priority : null,
		ttl: record.ttl,
		type: record.type,
	};
}

/** The body DNSimple wants for a record: the name relative to the zone, empty for the apex. */
function toBody(zone: DnsZone, input: DnsRecordInput): Record<string, unknown> {
	const name = relativeName(input.name, zone);
	return {
		content: ["CNAME", "MX"].includes(input.type)
			? bareTarget(input.content)
			: input.content,
		name: name === "@" ? "" : name,
		type: input.type,
		...(input.ttl != null ? { ttl: input.ttl } : {}),
		...(input.priority != null ? { priority: input.priority } : {}),
	};
}

/** A DNSimple v2 client authenticated with an API token, on `accountId` or the account `/whoami` (or `/accounts`) resolves the token to. */
export function dnsimpleClient(
	token: string,
	accountId?: string,
): DnsProviderClient {
	const call = <T>(path: string, init: RequestInit = {}): Promise<T> =>
		providerRequest<T>(
			"DNSimple",
			`${API}${path}`,
			{
				...init,
				headers: {
					accept: "application/json",
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
			},
			describe,
		);
	let account: Promise<string> | null = accountId
		? Promise.resolve(accountId)
		: null;
	const resolveAccount = async (): Promise<string> => {
		const who = await call<Page<{ account: { id: number } | null }>>("/whoami");
		if (who.data.account) {
			return String(who.data.account.id);
		}
		const accounts = await call<Page<{ id: number }[]>>("/accounts");
		const first = accounts.data[0];
		if (!first) {
			throw new DnsProviderError(
				404,
				"DNSimple: this token has no account, set the account ID.",
			);
		}
		return String(first.id);
	};
	const base = () => {
		account ??= resolveAccount().catch((error: unknown) => {
			account = null;
			throw error;
		});
		return account;
	};
	const all = async <T>(path: string, page = 1): Promise<T[]> => {
		const body = await call<Page<T[]>>(
			`/${await base()}${path}?per_page=100&page=${page}`,
		);
		const more = (body.pagination?.total_pages ?? 1) > page;
		return more ? [...body.data, ...(await all<T>(path, page + 1))] : body.data;
	};
	const recordPath = async (zone: DnsZone, id?: string) =>
		`/${await base()}/zones/${zone.id}/records${id ? `/${id}` : ""}`;
	return {
		async createRecord(zone: DnsZone, input: DnsRecordInput) {
			const body = await call<Page<DnsimpleRecord>>(await recordPath(zone), {
				body: JSON.stringify(toBody(zone, input)),
				method: "POST",
			});
			return toRecord(body.data, zone);
		},
		async deleteRecord(zone: DnsZone, record: DnsRecord) {
			try {
				await call(await recordPath(zone, record.id), { method: "DELETE" });
			} catch (error) {
				if (!(error instanceof DnsProviderError && error.status === 404)) {
					throw error;
				}
			}
		},
		async listRecords(zone: DnsZone) {
			return (await all<DnsimpleRecord>(`/zones/${zone.id}/records`)).map(
				(record) => toRecord(record, zone),
			);
		},
		async listZones() {
			return (await all<{ name: string }>("/zones")).map((zone) => ({
				id: normalizeName(zone.name),
				name: normalizeName(zone.name),
			}));
		},
		async updateRecord(
			zone: DnsZone,
			record: DnsRecord,
			input: DnsRecordInput,
		) {
			if (record.type !== input.type) {
				const created = await this.createRecord(zone, input);
				await this.deleteRecord(zone, record);
				return created;
			}
			const body = toBody(zone, input);
			delete body.type;
			const updated = await call<Page<DnsimpleRecord>>(
				await recordPath(zone, record.id),
				{ body: JSON.stringify(body), method: "PATCH" },
			);
			return toRecord(updated.data, zone);
		},
	};
}

export const dnsimple: DnsProviderDefinition = {
	create: (credentials) =>
		dnsimpleClient(credentials.token ?? "", credentials.accountId || undefined),
	docsUrl: "https://support.dnsimple.com/articles/api-access-token/",
	fields: [
		{
			help: "An account access token (Account → Access tokens). DNSimple tokens aren't scoped: an account token manages every zone in that account.",
			key: "token",
			label: "API access token",
			secret: true,
		},
		{
			help: "The numeric account ID. Leave empty with an account token, Homerun reads it from the token; set it when a user token can reach several accounts.",
			key: "accountId",
			label: "Account ID",
			optional: true,
			secret: false,
		},
	],
	id: "dnsimple",
	name: "DNSimple",
};
