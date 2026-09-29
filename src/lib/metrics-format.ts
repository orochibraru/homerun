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

/** How a number moved against the previous period, and whether that's good news. */
export interface Change {
	direction: "better" | "worse" | "same";
	text: string;
}

/**
 * The change from `previous` to `current`: relative (+12%) for counts, times
 * and sizes, or in percentage points (+0.4 pts) for a rate that's already a
 * percentage. `higherIsBetter` null means the direction says nothing good or
 * bad (more requests), so it reads as "same". Null when there's nothing to
 * compare: no previous value, or a relative change from zero.
 */
export function formatChange(
	current: number | null,
	previous: number | null,
	options: { higherIsBetter: boolean | null; points?: boolean },
): Change | null {
	if (current === null || previous === null) {
		return null;
	}
	const delta = options.points
		? current - previous
		: previous === 0
			? null
			: ((current - previous) / previous) * 100;
	if (delta === null) {
		return null;
	}
	const rounded = Math.abs(delta) < 0.05 ? 0 : delta;
	const text = `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${Math.abs(rounded).toFixed(options.points ? 2 : 1)}${options.points ? " pts" : "%"}`;
	if (rounded === 0 || options.higherIsBetter === null) {
		return { direction: "same", text };
	}
	return {
		direction: rounded > 0 === options.higherIsBetter ? "better" : "worse",
		text,
	};
}
