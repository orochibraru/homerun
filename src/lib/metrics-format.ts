/** A count, compact past ten thousand (12.3K). */
export function formatCount(value: number): string {
	return new Intl.NumberFormat(undefined, {
		maximumFractionDigits: 1,
		notation: value >= 10_000 ? "compact" : "standard",
	}).format(value);
}

/** A duration in milliseconds, in seconds past one; a dash for none. */
export function formatMs(value: number | null): string {
	if (value === null) {
		return "—";
	}
	return value >= 1000
		? `${(value / 1000).toFixed(2)} s`
		: `${Math.round(value)} ms`;
}

/** `part` as a percentage of `whole`, a dash when there's nothing to divide by. */
export function formatPercent(part: number, whole: number, digits = 1): string {
	return whole ? `${((part / whole) * 100).toFixed(digits)}%` : "—";
}

/** Megabytes, in gigabytes past 1024; a dash for none. */
export function formatMb(value: number | null): string {
	if (value === null) {
		return "—";
	}
	return value >= 1024
		? `${(value / 1024).toFixed(2)} GB`
		: `${Math.round(value)} MB`;
}
