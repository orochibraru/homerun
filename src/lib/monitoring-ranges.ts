export const MONITORING_RANGES = [
	{ id: "today", label: "Today" },
	{ id: "week", label: "7 days" },
	{ id: "month", label: "30 days" },
	{ id: "year", label: "12 months" },
	{ id: "all", label: "All time" },
] as const;

export type MonitoringRange = (typeof MONITORING_RANGES)[number]["id"];

const DAY_MS = 86_400_000;

const WINDOW_DAYS: Record<Exclude<MonitoringRange, "today" | "all">, number> = {
	month: 30,
	week: 7,
	year: 365,
};

/** Whether `value` is one of the ranges, for a query parameter that might not be. */
export function isMonitoringRange(value: unknown): value is MonitoringRange {
	return MONITORING_RANGES.some((range) => range.id === value);
}

/** Whether `zone` is an IANA time zone this runtime knows. */
export function isTimeZone(zone: string): boolean {
	try {
		return Boolean(
			new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
				.timeZone,
		);
	} catch {
		return false;
	}
}

/** How far `zone` is ahead of UTC at `at`, in milliseconds. */
function zoneOffsetMs(zone: string, at: Date): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			day: "2-digit",
			hour: "2-digit",
			hourCycle: "h23",
			minute: "2-digit",
			month: "2-digit",
			second: "2-digit",
			timeZone: zone,
			year: "numeric",
		})
			.formatToParts(at)
			.map((part) => [part.type, Number(part.value)]),
	);
	const asUtc = Date.UTC(
		parts.year ?? 0,
		(parts.month ?? 1) - 1,
		parts.day ?? 1,
		parts.hour ?? 0,
		parts.minute ?? 0,
		parts.second ?? 0,
	);
	return asUtc - (at.getTime() - at.getMilliseconds());
}

/** Midnight of `now`'s day in `zone`. */
export function startOfDay(now: Date, zone: string): Date {
	const local = new Date(now.getTime() + zoneOffsetMs(zone, now));
	const midnightAsUtc = Date.UTC(
		local.getUTCFullYear(),
		local.getUTCMonth(),
		local.getUTCDate(),
	);
	const guess = new Date(midnightAsUtc - zoneOffsetMs(zone, now));
	return new Date(midnightAsUtc - zoneOffsetMs(zone, guess));
}

/** Where a range starts: midnight in `zone` for today, a fixed window back otherwise, null for all time. */
export function rangeStart(
	range: MonitoringRange,
	now: Date,
	zone: string,
): Date | null {
	if (range === "all") {
		return null;
	}
	if (range === "today") {
		return startOfDay(now, zone);
	}
	return new Date(now.getTime() - WINDOW_DAYS[range] * DAY_MS);
}

/** A chart bucket width for a span: about 48 points, in whole five-minute steps. */
export function bucketSecondsFor(spanMs: number): number {
	const step = 300;
	return Math.max(step, Math.ceil(spanMs / 1000 / 48 / step) * step);
}
