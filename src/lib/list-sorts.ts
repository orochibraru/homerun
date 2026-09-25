export interface SortOption {
	label: string;
	value: string;
}

export const BASE_SORTS: SortOption[] = [
	{ label: "Newest", value: "-created" },
	{ label: "Oldest", value: "created" },
	{ label: "Name (A–Z)", value: "name" },
	{ label: "Name (Z–A)", value: "-name" },
	{ label: "Recently updated", value: "-updated" },
];

export const STACK_SORTS: SortOption[] = [
	...BASE_SORTS,
	{ label: "Most services", value: "-services" },
];

/** The sort keys a set of options uses, without the descending `-`, for `parseListQuery`'s `sortKeys`. */
export function sortKeysOf(options: SortOption[]): string[] {
	return [...new Set(options.map((o) => o.value.replace(/^-/, "")))];
}
