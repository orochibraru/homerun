/**
 * Minimal standard 5-field cron ("min hour day month weekday") matcher :
 * no external dependency, deliberately: this app stays dependency-light
 * (see e.g. no AWS SDK for storage, no cron package here) and a redeploy
 * scheduler only needs minute-resolution matching, not a full spec.
 *
 * Supports a wildcard, a literal number, "a-b" ranges, "a,b,c" lists, and
 * step values (asterisk, slash, N) : combinable per field (e.g.
 * "0,30 9-17 * * 1-5"). Evaluated against the server's local time; no
 * timezone field.
 *
 * Pure, stateless parsing/matching : stays a pair of plain exported
 * functions rather than a class, same "pure transform doesn't need an
 * instance" precedent as docker/labels.ts's buildContainerLabels.
 */

const FIELD_RANGES = {
	day: [1, 31],
	hour: [0, 23],
	minute: [0, 59],
	month: [1, 12],
	weekday: [0, 6],
} as const;

type FieldName = keyof typeof FIELD_RANGES;
const FIELD_ORDER: FieldName[] = ["minute", "hour", "day", "month", "weekday"];

const STEP_PART_RE = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/;
const RANGE_RE = /^(\d+)(?:-(\d+))?$/;
const WHITESPACE_RE = /\s+/;

/** Parses one comma-separated part (e.g. "9-17", "*\/15", "5") into the values it covers, or null if malformed. */
function parsePart(part: string, min: number, max: number): number[] | null {
	const stepMatch = part.match(STEP_PART_RE);
	if (!stepMatch) {
		return null;
	}
	const [, base, stepStr] = stepMatch;
	const step = stepStr ? Number(stepStr) : 1;
	if (!(Number.isInteger(step) && step > 0)) {
		return null;
	}

	let rangeStart = min;
	let rangeEnd = max;
	if (base !== "*") {
		const rangeMatch = base.match(RANGE_RE);
		if (!rangeMatch) {
			return null;
		}
		rangeStart = Number(rangeMatch[1]);
		rangeEnd = rangeMatch[2] ? Number(rangeMatch[2]) : rangeStart;
	}
	if (rangeStart < min || rangeEnd > max || rangeStart > rangeEnd) {
		return null;
	}

	const values: number[] = [];
	for (let v = rangeStart; v <= rangeEnd; v += step) {
		values.push(v);
	}
	return values;
}

function parseField(raw: string, field: FieldName): Set<number> | null {
	const [min, max] = FIELD_RANGES[field];
	const values = new Set<number>();

	for (const part of raw.split(",")) {
		const parsed = parsePart(part, min, max);
		if (!parsed) {
			return null;
		}
		for (const v of parsed) {
			values.add(v);
		}
	}

	return values.size > 0 ? values : null;
}

export interface ParsedCron {
	day: Set<number>;
	dayRestricted: boolean;
	hour: Set<number>;
	minute: Set<number>;
	month: Set<number>;
	weekday: Set<number>;
	weekdayRestricted: boolean;
}

/** Parses a 5-field cron expression, or null if it's malformed. */
export function parseCronSchedule(schedule: string): ParsedCron | null {
	const parts = schedule.trim().split(WHITESPACE_RE);
	if (parts.length !== 5) {
		return null;
	}

	const fields: Partial<Record<FieldName, Set<number>>> = {};
	for (const [i, field] of FIELD_ORDER.entries()) {
		const parsed = parseField(parts[i], field);
		if (!parsed) {
			return null;
		}
		fields[field] = parsed;
	}
	return {
		...(fields as Record<FieldName, Set<number>>),
		dayRestricted: !parts[2].startsWith("*"),
		weekdayRestricted: !parts[4].startsWith("*"),
	};
}

/**
 * Whether the given schedule is due at the given date (minute resolution :
 * seconds are ignored). Day-of-month and weekday follow the standard cron
 * rule : OR when both are restricted, AND (i.e. only the restricted one
 * applies) otherwise, so "0 0 1 * 1" fires on the 1st *and* on every Monday.
 */
export function cronMatches(schedule: string, date: Date): boolean {
	const parsed = parseCronSchedule(schedule);
	if (!parsed) {
		return false;
	}
	const dayHit = parsed.day.has(date.getDate());
	const weekdayHit = parsed.weekday.has(date.getDay());
	const dateHit =
		parsed.dayRestricted && parsed.weekdayRestricted
			? dayHit || weekdayHit
			: dayHit && weekdayHit;
	return (
		parsed.minute.has(date.getMinutes()) &&
		parsed.hour.has(date.getHours()) &&
		parsed.month.has(date.getMonth() + 1) &&
		dateHit
	);
}

/** Whether two dates fall in the same calendar minute : used to guard against a double-fire within one due minute. */
export function sameMinute(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate() &&
		a.getHours() === b.getHours() &&
		a.getMinutes() === b.getMinutes()
	);
}
