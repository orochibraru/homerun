export interface Capacity {
	freeBytes: number;
	totalBytes: number;
	usedBytes: number;
}

export const DEFAULT_CAPACITY_ALERT_PERCENT = 85;

export const CAPACITY_RECOVERY_MARGIN = 5;

function bytes(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
}

/**
 * The size, use and free space `rclone about --json` reports, null when the
 * output says nothing usable (a backend that can't report its quota). A
 * missing figure is derived from the other two when it can be.
 */
export function parseRcloneAbout(stdout: string): Capacity | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") {
		return null;
	}
	const about = parsed as Record<string, unknown>;
	let total = bytes(about.total);
	let used = bytes(about.used);
	let free = bytes(about.free);
	if (total === null && used !== null && free !== null) {
		total = used + free;
	}
	if (total === null || total === 0) {
		return null;
	}
	used ??= free === null ? null : Math.max(total - free, 0);
	free ??= used === null ? null : Math.max(total - used, 0);
	return used === null || free === null
		? null
		: { freeBytes: free, totalBytes: total, usedBytes: used };
}

/** How full a destination is, 0 to 100. */
export function usedPercent(capacity: Capacity): number {
	return Math.min(100, (capacity.usedBytes / capacity.totalBytes) * 100);
}

/**
 * What a fresh measurement means for a destination's alert: send one when it
 * just crossed `thresholdPercent` with none sent yet, clear the sent one once
 * it dropped `CAPACITY_RECOVERY_MARGIN` points below (so a destination
 * hovering at the line doesn't alert on every check), nothing otherwise.
 */
export function capacityAlertChange(input: {
	alerted: boolean;
	capacity: Capacity;
	thresholdPercent: number;
}): "alert" | "none" | "recovered" {
	const percent = usedPercent(input.capacity);
	if (!input.alerted && percent >= input.thresholdPercent) {
		return "alert";
	}
	if (
		input.alerted &&
		percent < input.thresholdPercent - CAPACITY_RECOVERY_MARGIN
	) {
		return "recovered";
	}
	return "none";
}
