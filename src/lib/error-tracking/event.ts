export type ErrorLevel = "fatal" | "error" | "warning" | "info" | "debug";

export type IssueStatus = "unresolved" | "resolved" | "ignored";

export const ISSUE_STATUSES: IssueStatus[] = [
	"unresolved",
	"resolved",
	"ignored",
];

export interface StoredFrame {
	absPath: string | null;
	colno: number | null;
	contextLine: string | null;
	filename: string | null;
	function: string | null;
	inApp: boolean;
	lineno: number | null;
	module: string | null;
	postContext: string[];
	preContext: string[];
}

export interface StoredException {
	frames: StoredFrame[];
	handled: boolean | null;
	mechanism: string | null;
	module: string | null;
	type: string | null;
	value: string | null;
}

export interface StoredBreadcrumb {
	category: string | null;
	level: string | null;
	message: string | null;
	timestamp: string | null;
	type: string | null;
}

export interface StoredErrorEvent {
	breadcrumbs: StoredBreadcrumb[];
	contexts: Record<string, Record<string, unknown>>;
	culprit: string | null;
	environment: string | null;
	eventId: string;
	exceptions: StoredException[];
	fingerprint: string[] | null;
	level: ErrorLevel;
	message: string | null;
	platform: string | null;
	release: string | null;
	request: { method: string | null; url: string | null } | null;
	sdk: string | null;
	serverName: string | null;
	tags: [string, string][];
	timestamp: string;
	title: string;
	transaction: string | null;
	user: {
		email: string | null;
		id: string | null;
		ipAddress: string | null;
		username: string | null;
	} | null;
}

const MAX_SHORT = 256;
const MAX_TEXT = 2048;
const MAX_LINE = 400;
const MAX_CONTEXT_LINES = 5;
const MAX_FRAMES = 60;
const MAX_EXCEPTIONS = 5;
const MAX_BREADCRUMBS = 50;
const MAX_TAGS = 50;
const MAX_CONTEXT_BYTES = 4096;
const MAX_CONTEXTS = 12;
const MAX_FUTURE_MS = 60_000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LEVELS = new Set<string>(["fatal", "error", "warning", "info", "debug"]);
const EVENT_ID_RE = /^[0-9a-f]{32}$/;

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Json)
		: null;
}

function str(value: unknown, max = MAX_SHORT): string | null {
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (typeof value !== "string" || value === "") {
		return null;
	}
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function int(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value)
		? Math.trunc(value)
		: null;
}

function listOf(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	const values = asObject(value)?.values;
	return Array.isArray(values) ? values : [];
}

function lines(value: unknown): string[] {
	return Array.isArray(value)
		? value.slice(-MAX_CONTEXT_LINES).map((line) => str(line, MAX_LINE) ?? "")
		: [];
}

function frameOf(raw: unknown): StoredFrame | null {
	const frame = asObject(raw);
	if (!frame) {
		return null;
	}
	return {
		absPath: str(frame.abs_path, MAX_TEXT),
		colno: int(frame.colno),
		contextLine: str(frame.context_line, MAX_LINE),
		filename: str(frame.filename, MAX_TEXT),
		function: str(frame.function),
		inApp: frame.in_app === true,
		lineno: int(frame.lineno),
		module: str(frame.module),
		postContext: Array.isArray(frame.post_context)
			? frame.post_context
					.slice(0, MAX_CONTEXT_LINES)
					.map((line) => str(line, MAX_LINE) ?? "")
			: [],
		preContext: lines(frame.pre_context),
	};
}

/** Keeps the oldest few and the newest frames of a long stack, the way Sentry trims the middle. */
function trimFrames(frames: StoredFrame[]): StoredFrame[] {
	if (frames.length <= MAX_FRAMES) {
		return frames;
	}
	const head = 10;
	return [
		...frames.slice(0, head),
		...frames.slice(frames.length - (MAX_FRAMES - head)),
	];
}

function exceptionOf(raw: unknown): StoredException | null {
	const exception = asObject(raw);
	if (!exception) {
		return null;
	}
	const mechanism = asObject(exception.mechanism);
	const frames = listOf(asObject(exception.stacktrace)?.frames)
		.map(frameOf)
		.filter((frame): frame is StoredFrame => frame !== null);
	const type = str(exception.type);
	const value = str(exception.value, MAX_TEXT);
	if (!(type || value || frames.length > 0)) {
		return null;
	}
	return {
		frames: trimFrames(frames),
		handled: typeof mechanism?.handled === "boolean" ? mechanism.handled : null,
		mechanism: str(mechanism?.type),
		module: str(exception.module),
		type,
		value,
	};
}

function messageOf(event: Json): string | null {
	const direct = event.message;
	if (typeof direct === "string") {
		return str(direct, MAX_TEXT);
	}
	for (const source of [asObject(direct), asObject(event.logentry)]) {
		const text =
			str(source?.formatted, MAX_TEXT) ?? str(source?.message, MAX_TEXT);
		if (text) {
			return text;
		}
	}
	return null;
}

function levelOf(value: unknown): ErrorLevel {
	const level = typeof value === "string" ? value.toLowerCase() : "";
	if (level === "warn") {
		return "warning";
	}
	if (level === "critical") {
		return "fatal";
	}
	return LEVELS.has(level) ? (level as ErrorLevel) : "error";
}

function tagsOf(value: unknown): [string, string][] {
	const pairs: [unknown, unknown][] = Array.isArray(value)
		? value.filter(Array.isArray).map((pair) => [pair[0], pair[1]])
		: Object.entries(asObject(value) ?? {});
	const tags: [string, string][] = [];
	for (const [key, tagValue] of pairs) {
		const name = str(key, 64);
		const text = str(tagValue, 200);
		if (name && text) {
			tags.push([name, text]);
		}
	}
	return tags.slice(0, MAX_TAGS);
}

function contextsOf(value: unknown): Record<string, Record<string, unknown>> {
	const contexts: Record<string, Record<string, unknown>> = {};
	for (const [key, context] of Object.entries(asObject(value) ?? {}).slice(
		0,
		MAX_CONTEXTS,
	)) {
		const object = asObject(context);
		if (object && JSON.stringify(object).length <= MAX_CONTEXT_BYTES) {
			contexts[key.slice(0, 64)] = object;
		}
	}
	return contexts;
}

function breadcrumbsOf(value: unknown): StoredBreadcrumb[] {
	return listOf(value)
		.slice(-MAX_BREADCRUMBS)
		.map(asObject)
		.filter((crumb): crumb is Json => crumb !== null)
		.map((crumb) => ({
			category: str(crumb.category),
			level: str(crumb.level, 16),
			message:
				str(crumb.message, 500) ??
				(crumb.data ? str(JSON.stringify(crumb.data), 500) : null),
			timestamp: timestampOf(crumb.timestamp)?.toISOString() ?? null,
			type: str(crumb.type, 32),
		}));
}

function timestampOf(value: unknown): Date | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return new Date(value * 1000);
	}
	if (typeof value === "string" && value !== "") {
		const numeric = Number(value);
		const date = Number.isFinite(numeric)
			? new Date(numeric * 1000)
			: new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	return null;
}

function eventTime(value: unknown, receivedAt: Date): Date {
	const date = timestampOf(value);
	if (
		!date ||
		date.getTime() > receivedAt.getTime() + MAX_FUTURE_MS ||
		date.getTime() < receivedAt.getTime() - MAX_AGE_MS
	) {
		return receivedAt;
	}
	return date;
}

function userOf(value: unknown): StoredErrorEvent["user"] {
	const user = asObject(value);
	if (!user) {
		return null;
	}
	const stored = {
		email: str(user.email),
		id: str(user.id),
		ipAddress: str(user.ip_address, 64),
		username: str(user.username),
	};
	return Object.values(stored).some(Boolean) ? stored : null;
}

function requestOf(value: unknown): StoredErrorEvent["request"] {
	const request = asObject(value);
	if (!request) {
		return null;
	}
	const url = str(request.url, MAX_TEXT);
	const method = str(request.method, 16);
	return url || method ? { method, url } : null;
}

function sdkOf(value: unknown): string | null {
	const sdk = asObject(value);
	const name = str(sdk?.name, 64);
	return name ? [name, str(sdk?.version, 32)].filter(Boolean).join("@") : null;
}

/** The exception a title is about: the last in the chain, the one actually raised. */
export function mainException(event: {
	exceptions: StoredException[];
}): StoredException | null {
	return event.exceptions.at(-1) ?? null;
}

/** The frame an error is blamed on: the innermost in-app frame, else the innermost frame. */
export function culpritFrame(frames: StoredFrame[]): StoredFrame | null {
	for (let index = frames.length - 1; index >= 0; index -= 1) {
		if (frames[index].inApp) {
			return frames[index];
		}
	}
	return frames.at(-1) ?? null;
}

function titleOf(
	exception: StoredException | null,
	message: string | null,
): string {
	if (exception && (exception.type || exception.value)) {
		const text = [exception.type, exception.value].filter(Boolean).join(": ");
		return text.split("\n")[0].slice(0, 200);
	}
	return message?.split("\n")[0].slice(0, 200) || "<unlabeled event>";
}

function culpritOf(
	exception: StoredException | null,
	event: Json,
): string | null {
	const frame = exception ? culpritFrame(exception.frames) : null;
	if (frame && (frame.function || frame.filename || frame.module)) {
		const where = frame.filename ?? frame.module;
		return str(
			frame.function ? `${frame.function}${where ? ` (${where})` : ""}` : where,
		);
	}
	return str(event.transaction) ?? str(event.culprit);
}

/**
 * Turns an SDK's event payload into the bounded shape Homerun stores: every
 * string capped, stacks trimmed to 60 frames, at most 5 chained exceptions, the
 * last 50 breadcrumbs, 50 tags and a dozen small contexts. Everything else the
 * SDK sent (request headers and bodies, local variables, modules, debug meta)
 * is dropped. Returns null for something that isn't a JSON object.
 */
export function normalizeEvent(
	raw: unknown,
	receivedAt: Date,
): StoredErrorEvent | null {
	const event = asObject(raw);
	if (!event) {
		return null;
	}
	const exceptions = listOf(event.exception)
		.map(exceptionOf)
		.filter((exception): exception is StoredException => exception !== null)
		.slice(-MAX_EXCEPTIONS);
	const message = messageOf(event);
	const exception = mainException({ exceptions });
	const rawId =
		typeof event.event_id === "string"
			? event.event_id.replaceAll("-", "").toLowerCase()
			: "";
	const fingerprint = Array.isArray(event.fingerprint)
		? event.fingerprint
				.slice(0, 20)
				.map((part) => str(part) ?? "")
				.filter(Boolean)
		: null;
	return {
		breadcrumbs: breadcrumbsOf(event.breadcrumbs),
		contexts: contextsOf(event.contexts),
		culprit: culpritOf(exception, event),
		environment: str(event.environment, 64),
		eventId: EVENT_ID_RE.test(rawId)
			? rawId
			: crypto.randomUUID().replaceAll("-", ""),
		exceptions,
		fingerprint: fingerprint && fingerprint.length > 0 ? fingerprint : null,
		level: levelOf(event.level),
		message,
		platform: str(event.platform, 32),
		release: str(event.release, 200),
		request: requestOf(event.request),
		sdk: sdkOf(event.sdk),
		serverName: str(event.server_name),
		tags: tagsOf(event.tags),
		timestamp: eventTime(event.timestamp, receivedAt).toISOString(),
		title: titleOf(exception, message),
		transaction: str(event.transaction),
		user: userOf(event.user),
	};
}

/** One key identifying the user an event happened to, for counting users affected. Null when the SDK sent none. */
export function userKeyOf(event: StoredErrorEvent): string | null {
	const user = event.user;
	return user
		? (user.id ?? user.email ?? user.username ?? user.ipAddress)
		: null;
}
