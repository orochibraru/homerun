import { bareTarget, DnsProviderError, normalizeName } from "./http";
import type { DnsProviderClient, DnsRecord, DnsRecordInput } from "./types";

export interface Rrset {
	name: string;
	ttl: number | null;
	type: string;
	values: string[];
}

export interface RrsetStore {
	create(rrset: Rrset): Promise<unknown>;
	get(name: string, type: string): Promise<Rrset | null>;
	remove(name: string, type: string): Promise<unknown>;
	replace(rrset: Rrset): Promise<unknown>;
}

export function fromRrsetValue(
	type: string,
	value: string,
): { content: string; priority: number | null } {
	if (type === "MX") {
		const [priority = "", ...target] = value.trim().split(/\s+/);
		return {
			content: bareTarget(target.join(" ")),
			priority: Number(priority),
		};
	}
	if (type === "CNAME" || type === "NS") {
		return { content: bareTarget(value), priority: null };
	}
	if (type === "TXT") {
		const segments = [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
		return {
			content: segments.length
				? segments
						.map((segment) => segment[1])
						.join("")
						.replace(/\\(.)/g, "$1")
				: value,
			priority: null,
		};
	}
	return { content: value, priority: null };
}

/** The common record content back into a zone-file RDATA value: dotted targets, quoted TXT, `priority target.` MX. */
export function toRrsetValue(input: DnsRecordInput): string {
	if (input.type === "MX") {
		return `${input.priority ?? 10} ${bareTarget(input.content)}.`;
	}
	if (input.type === "CNAME") {
		return `${bareTarget(input.content)}.`;
	}
	if (input.type === "TXT") {
		return `"${input.content.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return input.content;
}

/** One rrset (full name) spread into one common record per value, each with a `type:name:content` id. */
export function rrsetRecords(rrset: Rrset): DnsRecord[] {
	const name = normalizeName(rrset.name);
	return rrset.values.map((value) => {
		const { content, priority } = fromRrsetValue(rrset.type, value);
		return {
			content,
			id: `${rrset.type}:${name}:${content}`,
			name,
			priority,
			ttl: rrset.ttl,
			type: rrset.type,
		};
	});
}

/** Whether an rrset value is the one a common record was mapped from. */
function sameValue(type: string, value: string, record: DnsRecord): boolean {
	const decoded = fromRrsetValue(type, value);
	return (
		decoded.content === record.content &&
		(type !== "MX" || decoded.priority === record.priority)
	);
}

/** `promise`'s result, or `null` when the provider answered 404. */
export async function orNull<T>(promise: Promise<T>): Promise<T | null> {
	try {
		return await promise;
	} catch (error) {
		if (error instanceof DnsProviderError && error.status === 404) {
			return null;
		}
		throw error;
	}
}

/**
 * Record-level create/update/delete over an API that only stores whole
 * rrsets: each change reads the rrset and writes it back with the one value
 * added, swapped or dropped, keeping the others. An rrset left empty is
 * deleted.
 */
export function rrsetEditor(
	store: RrsetStore,
): Pick<DnsProviderClient, "createRecord" | "deleteRecord" | "updateRecord"> {
	const add = async (input: DnsRecordInput): Promise<DnsRecord> => {
		const value = toRrsetValue(input);
		const existing = await store.get(input.name, input.type);
		const rrset = {
			name: input.name,
			ttl: input.ttl ?? existing?.ttl ?? null,
			type: input.type,
			values: [...new Set([...(existing?.values ?? []), value])],
		};
		await (existing ? store.replace(rrset) : store.create(rrset));
		return rrsetRecords({ ...rrset, values: [value] })[0] as DnsRecord;
	};
	const remove = async (record: DnsRecord) => {
		const existing = await store.get(record.name, record.type);
		if (!existing) {
			return;
		}
		const values = existing.values.filter(
			(value) => !sameValue(record.type, value, record),
		);
		await orNull(
			values.length
				? store.replace({ ...existing, name: record.name, values })
				: store.remove(record.name, record.type),
		);
	};
	return {
		createRecord: (_zone, input) => add(input),
		deleteRecord: (_zone, record) => remove(record),
		async updateRecord(_zone, record, input) {
			const sameRrset =
				normalizeName(record.name) === normalizeName(input.name) &&
				record.type === input.type;
			const existing = sameRrset
				? await store.get(record.name, record.type)
				: null;
			if (!existing) {
				await remove(record);
				return add(input);
			}
			const value = toRrsetValue(input);
			const values = existing.values.map((current) =>
				sameValue(record.type, current, record) ? value : current,
			);
			const rrset = {
				name: input.name,
				ttl: input.ttl ?? existing.ttl,
				type: input.type,
				values: [...new Set([...values, value])],
			};
			await store.replace(rrset);
			return rrsetRecords({ ...rrset, values: [value] })[0] as DnsRecord;
		},
	};
}

/** Gandi's `message`, plus each field error's description when it lists them. */
