import { describe, expect, test } from "bun:test";

import {
	decodeCursor,
	encodeCursor,
	formatLogLines,
	logRetentionDays,
	parseLogHistoryQuery,
	parseLogRetentionDays,
} from "#lib/logs/history.js";

const now = new Date("2026-10-28T12:00:00.000Z");

describe("parseLogHistoryQuery", () => {
	test("defaults to the given range and page size", () => {
		const query = parseLogHistoryQuery(new URLSearchParams(), now, "24h");
		expect(query.from?.toISOString()).toBe("2026-10-27T12:00:00.000Z");
		expect(query.to).toBeNull();
		expect(query.limit).toBe(200);
		expect(query.q).toBe("");
		expect(query.regex).toBe(false);
	});

	test("explicit from/to win over the range", () => {
		const query = parseLogHistoryQuery(
			new URLSearchParams({
				from: "2026-10-01T00:00:00Z",
				range: "1h",
				to: "2026-10-02T00:00:00Z",
			}),
			now,
		);
		expect(query.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		expect(query.to?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
	});

	test("all means no lower bound", () => {
		expect(
			parseLogHistoryQuery(new URLSearchParams({ range: "all" }), now, "24h")
				.from,
		).toBeNull();
	});

	test("reads the filters and a checkbox's regex", () => {
		const query = parseLogHistoryQuery(
			new URLSearchParams({
				deploymentId: "dep",
				instance: "abc",
				q: "  boom ",
				regex: "on",
				stream: "stderr",
			}),
			now,
		);
		expect(query).toMatchObject({
			deploymentId: "dep",
			instance: "abc",
			q: "boom",
			regex: true,
			stream: "stderr",
		});
	});

	test.each([
		[{ limit: "0" }],
		[{ limit: "5000" }],
		[{ from: "yesterday-ish" }],
		[{ range: "1y" }],
		[{ stream: "stdin" }],
		[{ before: "nope" }],
	])("rejects %p", (params) => {
		expect(() =>
			parseLogHistoryQuery(new URLSearchParams(params), now),
		).toThrow();
	});
});

describe("cursors", () => {
	test("round-trip", () => {
		const cursor = { id: 42, time: "2026-10-28T11:59:59.123456Z" };
		expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
	});

	test("garbage decodes to null", () => {
		expect(decodeCursor("2026-10-28~1")).toBeNull();
		expect(decodeCursor(null)).toBeNull();
	});
});

describe("retention", () => {
	test("defaults to 7 days", () => {
		expect(logRetentionDays({ logRetentionDays: null })).toBe(7);
		expect(logRetentionDays({ logRetentionDays: 30 })).toBe(30);
	});

	test("parses whole days within range only", () => {
		expect(parseLogRetentionDays("14")).toBe(14);
		expect(parseLogRetentionDays("0")).toBeNull();
		expect(parseLogRetentionDays("91")).toBeNull();
		expect(parseLogRetentionDays("1.5")).toBeNull();
		expect(parseLogRetentionDays(null)).toBeNull();
	});
});

test("formatLogLines prints oldest first", () => {
	const line = (id: number, text: string) => ({
		deploymentId: null,
		id,
		instance: "abc",
		line: text,
		stream: "stdout" as const,
		time: `2026-10-28T12:00:0${id}.000000Z`,
	});
	expect(formatLogLines([line(2, "second"), line(1, "first")])).toBe(
		"2026-10-28T12:00:01.000000Z [abc] first\n2026-10-28T12:00:02.000000Z [abc] second\n",
	);
});
