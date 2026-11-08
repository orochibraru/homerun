export type MailLogLevel = "error" | "info" | "warn";

export interface MailLogLine {
	delivery: boolean;
	level: MailLogLevel;
	raw: string;
	time: string | null;
}

export interface DeliveryFailure {
	reason: string;
	recipient: string;
	status: "bounced" | "deferred";
	time: string | null;
}

export interface MailLogSummary {
	bounced: number;
	deferred: number;
	errors: number;
	failedSignIns: number;
}

const TIME_RE =
	/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s/;
const ERROR_RE = /\b(?:error|fatal|panic|status=bounced|reject:)/i;
const WARN_RE =
	/\b(?:warning|status=deferred|authentication failed|auth failed|timed out)/i;
const DELIVERY_RE = /\bstatus=(?:sent|bounced|deferred|expired)\b/;
const FAILURE_RE =
	/\bto=<([^>]*)>.*?\bstatus=(bounced|deferred)\s*\((.*)\)\s*$/;
const SIGN_IN_FAILURE_RE = /authentication failed|auth failed/i;

/** How serious one line of docker-mailserver's output is, from Postfix's, Dovecot's and rspamd's own wording. */
export function mailLogLevel(line: string): MailLogLevel {
	if (ERROR_RE.test(line)) {
		return "error";
	}
	return WARN_RE.test(line) ? "warn" : "info";
}

/** Splits docker-mailserver's output into lines with their timestamp, level and whether they report a delivery. */
export function parseMailLog(text: string): MailLogLine[] {
	return text
		.split("\n")
		.map((raw) => raw.trimEnd())
		.filter(Boolean)
		.map((raw) => ({
			delivery: DELIVERY_RE.test(raw),
			level: mailLogLevel(raw),
			raw,
			time: TIME_RE.exec(raw)?.[1] ?? null,
		}));
}

/** Every bounced or deferred delivery in `lines`, oldest first, with the receiving server's reason. */
export function deliveryFailures(lines: MailLogLine[]): DeliveryFailure[] {
	const failures: DeliveryFailure[] = [];
	for (const line of lines) {
		const match = FAILURE_RE.exec(line.raw);
		if (match) {
			failures.push({
				reason: match[3]?.trim() ?? "",
				recipient: match[1] ?? "",
				status: match[2] === "bounced" ? "bounced" : "deferred",
				time: line.time,
			});
		}
	}
	return failures;
}

/** Counts of what went wrong in `lines`: bounces, deferrals, failed sign-ins and other errors. */
export function summarizeMailLog(lines: MailLogLine[]): MailLogSummary {
	const failures = deliveryFailures(lines);
	return {
		bounced: failures.filter((failure) => failure.status === "bounced").length,
		deferred: failures.filter((failure) => failure.status === "deferred")
			.length,
		errors: lines.filter((line) => line.level === "error" && !line.delivery)
			.length,
		failedSignIns: lines.filter((line) => SIGN_IN_FAILURE_RE.test(line.raw))
			.length,
	};
}

/** What tells one logged failure from another for de-duplication: its time, recipient, status and reason. */
export function failureKey(failure: DeliveryFailure): string {
	return [failure.time, failure.recipient, failure.status, failure.reason].join(
		"\u0000",
	);
}

/**
 * The failures in `failures` not yet reported: those logged after `since`
 * (an ISO time), plus those logged at exactly `since` whose key isn't in
 * `reportedAtSince`, so a line written after a pass but stamped with its last
 * timestamp isn't lost. All of them when `since` is null.
 */
export function failuresSince(
	failures: DeliveryFailure[],
	since: string | null,
	reportedAtSince: ReadonlySet<string> = new Set(),
): DeliveryFailure[] {
	if (!since) {
		return failures;
	}
	const cutoff = Date.parse(since);
	return failures.filter((failure) => {
		if (failure.time === null) {
			return false;
		}
		const at = Date.parse(failure.time);
		return (
			at > cutoff ||
			(at === cutoff && !reportedAtSince.has(failureKey(failure)))
		);
	});
}
