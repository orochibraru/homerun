import { describe, expect, test } from "bun:test";

const {
	deliveryFailures,
	failureKey,
	failuresSince,
	mailLogLevel,
	parseMailLog,
	summarizeMailLog,
} = await import("../../../src/lib/mail-log");

const log = [
	"2026-11-08T10:00:00.000000+00:00 mail postfix/smtp[101]: 1A2B: to=<jane@other.org>, relay=mx.other.org[1.2.3.4]:25, delay=1, dsn=2.0.0, status=sent (250 2.0.0 OK)",
	"2026-11-08T10:01:00.000000+00:00 mail postfix/smtp[102]: 3C4D: to=<nobody@other.org>, relay=mx.other.org[1.2.3.4]:25, dsn=5.1.1, status=bounced (host mx.other.org[1.2.3.4] said: 550 5.1.1 User unknown (in reply to RCPT TO command))",
	"2026-11-08T10:02:00.000000+00:00 mail postfix/smtp[103]: 5E6F: to=<joe@slow.net>, relay=none, delay=30, dsn=4.4.1, status=deferred (connect to mx.slow.net[5.6.7.8]:25: Connection timed out)",
	"2026-11-08T10:03:00.000000+00:00 mail dovecot: auth: passwd-file(jane@example.com,9.9.9.9): Password mismatch",
	"2026-11-08T10:04:00.000000+00:00 mail postfix/smtpd[104]: warning: unknown[9.9.9.9]: SASL LOGIN authentication failed: UGFzc3dvcmQ6",
	"2026-11-08T10:05:00.000000+00:00 mail rspamd[50]: fatal error: something broke",
	"",
].join("\n");

describe("parseMailLog", () => {
	const lines = parseMailLog(log);

	test("one line per output line, with its time and level", () => {
		expect(lines).toHaveLength(6);
		expect(lines[0]?.time).toBe("2026-11-08T10:00:00.000000+00:00");
		expect(lines.map((line) => line.level)).toEqual([
			"info",
			"error",
			"warn",
			"info",
			"warn",
			"error",
		]);
		expect(lines.filter((line) => line.delivery)).toHaveLength(3);
	});

	test("bounces and deferrals carry the recipient and the remote reason", () => {
		expect(deliveryFailures(lines)).toEqual([
			{
				reason:
					"host mx.other.org[1.2.3.4] said: 550 5.1.1 User unknown (in reply to RCPT TO command)",
				recipient: "nobody@other.org",
				status: "bounced",
				time: "2026-11-08T10:01:00.000000+00:00",
			},
			{
				reason: "connect to mx.slow.net[5.6.7.8]:25: Connection timed out",
				recipient: "joe@slow.net",
				status: "deferred",
				time: "2026-11-08T10:02:00.000000+00:00",
			},
		]);
	});

	test("the summary counts each kind once", () => {
		expect(summarizeMailLog(lines)).toEqual({
			bounced: 1,
			deferred: 1,
			errors: 1,
			failedSignIns: 1,
		});
	});

	test("only failures after the watermark are new", () => {
		const failures = deliveryFailures(lines);
		expect(failuresSince(failures, null)).toHaveLength(2);
		expect(
			failuresSince(failures, "2026-11-08T10:01:30.000000+00:00"),
		).toHaveLength(1);
	});

	test("a failure stamped at the watermark is new unless it was already reported", () => {
		const failures = deliveryFailures(lines);
		const at = "2026-11-08T10:02:00.000000+00:00";
		const deferred = failures.filter((failure) => failure.time === at);
		expect(failuresSince(failures, at)).toEqual(deferred);
		expect(
			failuresSince(failures, at, new Set(deferred.map(failureKey))),
		).toEqual([]);
	});

	test("a delivered message isn't a problem", () => {
		expect(mailLogLevel("status=sent (250 OK)")).toBe("info");
	});
});
