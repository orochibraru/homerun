import { type SortOption, sortKeysOf } from "#lib/list-sorts.js";

export const TRACE_SORTS: SortOption[] = [
	{ label: "Newest", value: "-started" },
	{ label: "Slowest", value: "-duration" },
	{ label: "Most spans", value: "-spans" },
];

export const TRACE_SORT_KEYS = sortKeysOf(TRACE_SORTS);

export const TRACE_FILTER_KEYS = ["status"];

const TRACE_ID_RE = /^[0-9a-f]{32}$/;

/** A trace id from a URL or an error event, lowercased, or null when it isn't 32 hex digits. */
export function normalizeTraceId(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const id = value.trim().toLowerCase();
	return TRACE_ID_RE.test(id) ? id : null;
}
