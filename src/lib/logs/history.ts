export const DEFAULT_LOG_RETENTION_DAYS = 7;

export const MIN_LOG_RETENTION_DAYS = 1;

export const MAX_LOG_RETENTION_DAYS = 90;

export const DEFAULT_LOG_PAGE = 200;

export const MAX_LOG_PAGE = 1000;

export const LOG_RANGES = {
	"15m": 15 * 60 * 1000,
	"1h": 60 * 60 * 1000,
	"24h": 24 * 60 * 60 * 1000,
	"6h": 6 * 60 * 60 * 1000,
	"7d": 7 * 24 * 60 * 60 * 1000,
	all: null,
} as const;

export type LogRange = keyof typeof LOG_RANGES;

export const LOG_RANGE_LABELS: [LogRange, string][] = [
	["15m", "Last 15 minutes"],
	["1h", "Last hour"],
	["6h", "Last 6 hours"],
	["24h", "Last 24 hours"],
	["7d", "Last 7 days"],
	["all", "Everything kept"],
];

export type LogStream = "stdout" | "stderr";

/** One stored log line as the history views and the API return it. */
export interface LogHistoryLine {
	deploymentId: string | null;
	id: number;
	instance: string;
	line: string;
	stream: LogStream;
	time: string;
}

/** What to search a service's stored logs for. */
export interface LogHistoryQuery {
	before: LogCursor | null;
	deploymentId: string | null;
	from: Date | null;
	instance: string | null;
	limit: number;
	q: string;
	regex: boolean;
	stream: LogStream | null;
	to: Date | null;
}

/** Where a page of history stopped: the oldest line it returned. */
export interface LogCursor {
	id: number;
	time: string;
}

/** One page of history, newest first, with the cursor for the page before it. */
export interface LogHistoryPage {
	lines: LogHistoryLine[];
	nextCursor: string | null;
}

const CURSOR_PATTERN =
	/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)~(\d{1,18})$/;

/** A cursor as the `before` parameter carries it. */
export function encodeCursor(cursor: LogCursor): string {
	return `${cursor.time}~${cursor.id}`;
}

/** The cursor a `before` parameter names, or null when it isn't one. */
export function decodeCursor(raw: string | null): LogCursor | null {
	const match = raw ? CURSOR_PATTERN.exec(raw) : null;
	return match ? { id: Number(match[2]), time: match[1] } : null;
}

/** A date parameter, ISO 8601 or anything `Date` reads, or null when it's missing or not a date. */
function parseDate(raw: string | null): Date | null {
	if (!raw) {
		return null;
	}
	const date = new Date(raw);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Whether `value` names one of the time ranges the history page offers. */
export function isLogRange(value: string | null): value is LogRange {
	return value !== null && Object.hasOwn(LOG_RANGES, value);
}

/** The `limit` parameter, defaulting to a page of 200. */
function parseLimit(params: URLSearchParams): number {
	const raw = params.get("limit");
	const limit = raw === null ? DEFAULT_LOG_PAGE : Number(raw);
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_PAGE) {
		throw new Error(`limit must be a whole number from 1 to ${MAX_LOG_PAGE}.`);
	}
	return limit;
}

/** The `from`/`to` window, or the `range` preset counted back from `now` when neither is set. */
function parseWindow(
	params: URLSearchParams,
	now: Date,
	defaultRange: LogRange,
): { from: Date | null; to: Date | null } {
	const fromRaw = params.get("from");
	const toRaw = params.get("to");
	const from = parseDate(fromRaw);
	const to = parseDate(toRaw);
	if ((fromRaw && !from) || (toRaw && !to)) {
		throw new Error("from and to must be ISO 8601 dates.");
	}
	const range = params.get("range");
	if (range && !isLogRange(range)) {
		throw new Error(
			`range must be one of ${Object.keys(LOG_RANGES).join(", ")}.`,
		);
	}
	if (fromRaw || toRaw) {
		return { from, to };
	}
	const span = LOG_RANGES[isLogRange(range) ? range : defaultRange];
	return { from: span === null ? null : new Date(now.getTime() - span), to };
}

/** The `stream` parameter, null for both. */
function parseStream(params: URLSearchParams): LogStream | null {
	const raw = params.get("stream");
	if (!raw) {
		return null;
	}
	if (raw !== "stdout" && raw !== "stderr") {
		throw new Error("stream must be stdout or stderr.");
	}
	return raw;
}

/**
 * Reads a history query out of URL parameters: `q` (with `regex=true`, or
 * `on` from a checkbox, for a case-insensitive POSIX regex instead of a
 * substring), `from`/`to` or a `range` preset counted back from `now`,
 * `deploymentId`, `instance`, `stream`, `limit` and the `before` cursor.
 *
 * @throws When `limit`, a date, `range`, `stream` or `before` is malformed,
 *   with a message fit to show the caller.
 */
export function parseLogHistoryQuery(
	params: URLSearchParams,
	now = new Date(),
	defaultRange: LogRange = "all",
): LogHistoryQuery {
	const beforeRaw = params.get("before");
	const before = decodeCursor(beforeRaw);
	if (beforeRaw && !before) {
		throw new Error("before must be a cursor a previous page returned.");
	}
	const regex = params.get("regex");
	return {
		before,
		deploymentId: params.get("deploymentId") || null,
		instance: params.get("instance") || null,
		limit: parseLimit(params),
		q: (params.get("q") ?? "").trim(),
		regex: regex === "true" || regex === "on",
		stream: parseStream(params),
		...parseWindow(params, now, defaultRange),
	};
}

/** The settings row's log retention with its default filled in. */
export function logRetentionDays(row: {
	logRetentionDays: number | null;
}): number {
	return row.logRetentionDays ?? DEFAULT_LOG_RETENTION_DAYS;
}

/** A retention typed into the settings form as whole days within range, or null when it isn't one. */
export function parseLogRetentionDays(raw: unknown): number | null {
	const text = typeof raw === "string" ? raw.trim() : "";
	if (!/^\d+$/.test(text)) {
		return null;
	}
	const days = Number(text);
	return days >= MIN_LOG_RETENTION_DAYS && days <= MAX_LOG_RETENTION_DAYS
		? days
		: null;
}

/** History lines as a plain-text download, oldest first, one `time [instance] line` per row. */
export function formatLogLines(lines: LogHistoryLine[]): string {
	return lines
		.toReversed()
		.map((line) => `${line.time} [${line.instance}] ${line.line}\n`)
		.join("");
}
