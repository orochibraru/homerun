export function matchesQuery(
	query: string,
	fields: (string | null | undefined)[],
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) {
		return true;
	}
	return fields.some((field) => field?.toLowerCase().includes(q) ?? false);
}

export function matchesFilter(
	selected: string[] | undefined,
	value: string | null | undefined,
): boolean {
	if (!selected || selected.length === 0) {
		return true;
	}
	return value !== null && value !== undefined && selected.includes(value);
}
