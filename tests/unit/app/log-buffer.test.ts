import { describe, expect, test } from "bun:test";

import { appendCapped, MAX_LOG_LINES } from "../../../src/lib/log-buffer";

describe("appendCapped", () => {
	test("appends under the limit without dropping anything", () => {
		expect(appendCapped([1, 2], [3], 5)).toEqual([1, 2, 3]);
	});

	test("keeps only the newest entries past the limit", () => {
		expect(appendCapped([1, 2, 3], [4, 5, 6], 4)).toEqual([3, 4, 5, 6]);
	});

	test("caps a single chunk bigger than the limit", () => {
		expect(appendCapped([], [1, 2, 3, 4], 2)).toEqual([3, 4]);
	});

	test("never mutates the existing array", () => {
		const existing = [1, 2];
		appendCapped(existing, [3], 2);
		expect(existing).toEqual([1, 2]);
	});

	test("defaults to a few thousand lines", () => {
		const lines = Array.from({ length: MAX_LOG_LINES + 10 }, (_, i) => i);
		const kept = appendCapped([], lines);
		expect(kept).toHaveLength(MAX_LOG_LINES);
		expect(kept[0]).toBe(10);
	});
});
