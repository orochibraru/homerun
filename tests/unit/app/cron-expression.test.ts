import { describe, expect, test } from "bun:test";
import {
	cronMatches,
	parseCronSchedule,
	sameMinute,
} from "../../../src/lib/services/cron/cron-expression";

const at = (iso: string) => new Date(iso);

describe("parseCronSchedule", () => {
	test("accepts wildcards, literals, ranges, lists and steps", () => {
		expect(parseCronSchedule("* * * * *")).not.toBeNull();
		expect(parseCronSchedule("0,30 9-17 * * 1-5")).not.toBeNull();
		expect(parseCronSchedule("*/15 * * * *")?.minute).toEqual(
			new Set([0, 15, 30, 45]),
		);
		expect(parseCronSchedule("10-20/5 * * * *")?.minute).toEqual(
			new Set([10, 15, 20]),
		);
		expect(parseCronSchedule("  0   0  *  *  * ")).not.toBeNull();
	});

	test("rejects malformed expressions", () => {
		for (const bad of [
			"",
			"* * * *",
			"* * * * * *",
			"60 * * * *",
			"* 24 * * *",
			"* * 0 * *",
			"* * 32 * *",
			"* * * 13 *",
			"* * * * 7",
			"20-10 * * * *",
			"*/0 * * * *",
			"a * * * *",
			"1- * * * *",
		]) {
			expect(parseCronSchedule(bad)).toBeNull();
		}
	});
});

describe("cronMatches", () => {
	test("matches every minute for the all-wildcard schedule", () => {
		expect(cronMatches("* * * * *", at("2026-09-06T13:37:00"))).toBe(true);
	});

	test("ignores seconds", () => {
		expect(cronMatches("37 13 * * *", at("2026-09-06T13:37:59"))).toBe(true);
	});

	test("respects each field", () => {
		const sunday = at("2026-09-06T09:00:00");
		expect(cronMatches("0 9 * * *", sunday)).toBe(true);
		expect(cronMatches("0 10 * * *", sunday)).toBe(false);
		expect(cronMatches("0 9 6 * *", sunday)).toBe(true);
		expect(cronMatches("0 9 7 * *", sunday)).toBe(false);
		expect(cronMatches("0 9 * 9 *", sunday)).toBe(true);
		expect(cronMatches("0 9 * 8 *", sunday)).toBe(false);
		expect(cronMatches("0 9 * * 0", sunday)).toBe(true);
		expect(cronMatches("0 9 * * 1", sunday)).toBe(false);
	});

	test("business-hours schedule fires only in range on weekdays", () => {
		expect(cronMatches("0,30 9-17 * * 1-5", at("2026-09-07T09:30:00"))).toBe(
			true,
		);
		expect(cronMatches("0,30 9-17 * * 1-5", at("2026-09-07T09:15:00"))).toBe(
			false,
		);
		expect(cronMatches("0,30 9-17 * * 1-5", at("2026-09-07T18:00:00"))).toBe(
			false,
		);
		expect(cronMatches("0,30 9-17 * * 1-5", at("2026-09-06T09:30:00"))).toBe(
			false,
		);
	});

	test("a malformed schedule never fires", () => {
		expect(cronMatches("nonsense", at("2026-09-06T13:37:00"))).toBe(false);
	});

	test("day-of-month and weekday are ORed when both are restricted", () => {
		expect(cronMatches("0 0 1 * 1", at("2026-06-01T00:00:00"))).toBe(true);
		expect(cronMatches("0 0 1 * 1", at("2026-09-01T00:00:00"))).toBe(true);
		expect(cronMatches("0 0 1 * 1", at("2026-09-07T00:00:00"))).toBe(true);
		expect(cronMatches("0 0 1 * 1", at("2026-09-02T00:00:00"))).toBe(false);
	});

	test("only the restricted one applies when the other is a wildcard", () => {
		expect(cronMatches("0 0 1 * *", at("2026-09-01T00:00:00"))).toBe(true);
		expect(cronMatches("0 0 1 * *", at("2026-09-07T00:00:00"))).toBe(false);
		expect(cronMatches("0 0 * * 1", at("2026-09-07T00:00:00"))).toBe(true);
		expect(cronMatches("0 0 * * 1", at("2026-09-01T00:00:00"))).toBe(false);
	});

	test("a stepped wildcard still counts as unrestricted, as in Vixie cron", () => {
		expect(cronMatches("0 0 */2 * 1", at("2026-09-07T00:00:00"))).toBe(true);
		expect(cronMatches("0 0 */2 * 1", at("2026-09-03T00:00:00"))).toBe(false);
	});
});

describe("sameMinute", () => {
	test("true within one calendar minute, false across any boundary", () => {
		expect(
			sameMinute(at("2026-09-06T13:37:00"), at("2026-09-06T13:37:59")),
		).toBe(true);
		expect(
			sameMinute(at("2026-09-06T13:37:59"), at("2026-09-06T13:38:00")),
		).toBe(false);
		expect(
			sameMinute(at("2026-09-06T13:37:00"), at("2026-09-07T13:37:00")),
		).toBe(false);
		expect(
			sameMinute(at("2026-09-06T13:37:00"), at("2025-09-06T13:37:00")),
		).toBe(false);
	});
});
