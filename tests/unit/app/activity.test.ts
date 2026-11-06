import { describe, expect, test } from "bun:test";

import {
	elapsedSeconds,
	formatElapsed,
	lastLogLine,
} from "../../../src/lib/activity";

describe("lastLogLine", () => {
	test("returns the last non-empty line", () => {
		expect(lastLogLine("Pulling image...\nStarting container...\n\n")).toBe(
			"Starting container...",
		);
	});

	test("is null for an empty or missing log", () => {
		expect(lastLogLine("")).toBeNull();
		expect(lastLogLine(null)).toBeNull();
		expect(lastLogLine("\n  \n")).toBeNull();
	});
});

describe("elapsedSeconds", () => {
	test("counts to now when unfinished", () => {
		const now = Date.parse("2026-01-01T00:01:30Z");
		expect(elapsedSeconds("2026-01-01T00:00:00Z", null, now)).toBe(90);
	});

	test("counts to the end when finished, never negative", () => {
		expect(
			elapsedSeconds("2026-01-01T00:00:00Z", "2026-01-01T00:00:12Z", 0),
		).toBe(12);
		expect(elapsedSeconds("2026-01-01T00:00:10Z", null, 0)).toBe(0);
	});
});

describe("formatElapsed", () => {
	test("formats seconds, minutes and hours", () => {
		expect(formatElapsed(42)).toBe("42s");
		expect(formatElapsed(185)).toBe("3m 05s");
		expect(formatElapsed(4320)).toBe("1h 12m");
	});
});
