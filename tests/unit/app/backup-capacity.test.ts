import { describe, expect, test } from "bun:test";

const { capacityAlertChange, parseRcloneAbout, usedPercent } = await import(
	"../../../src/lib/backup-capacity"
);

describe("parseRcloneAbout", () => {
	test("reads total, used and free", () => {
		expect(
			parseRcloneAbout('{"total":1000,"used":250,"free":750,"trashed":0}'),
		).toEqual({ freeBytes: 750, totalBytes: 1000, usedBytes: 250 });
	});

	test("derives the missing figure from the other two", () => {
		expect(parseRcloneAbout('{"total":1000,"used":400}')).toEqual({
			freeBytes: 600,
			totalBytes: 1000,
			usedBytes: 400,
		});
		expect(parseRcloneAbout('{"total":1000,"free":100}')).toEqual({
			freeBytes: 100,
			totalBytes: 1000,
			usedBytes: 900,
		});
		expect(parseRcloneAbout('{"used":300,"free":700}')).toEqual({
			freeBytes: 700,
			totalBytes: 1000,
			usedBytes: 300,
		});
	});

	test("nothing usable is null", () => {
		expect(parseRcloneAbout("not json")).toBeNull();
		expect(parseRcloneAbout("null")).toBeNull();
		expect(parseRcloneAbout('{"used":300}')).toBeNull();
		expect(parseRcloneAbout('{"total":0,"used":0}')).toBeNull();
		expect(parseRcloneAbout('{"total":100}')).toBeNull();
		expect(parseRcloneAbout('{"total":-1,"used":1,"free":2}')).toEqual({
			freeBytes: 2,
			totalBytes: 3,
			usedBytes: 1,
		});
	});
});

describe("usedPercent", () => {
	test("is capped at 100", () => {
		expect(usedPercent({ freeBytes: 0, totalBytes: 100, usedBytes: 50 })).toBe(
			50,
		);
		expect(usedPercent({ freeBytes: 0, totalBytes: 100, usedBytes: 120 })).toBe(
			100,
		);
	});
});

describe("capacityAlertChange", () => {
	const at = (used: number) => ({
		freeBytes: 100 - used,
		totalBytes: 100,
		usedBytes: used,
	});

	test("alerts once on crossing the threshold", () => {
		expect(
			capacityAlertChange({
				alerted: false,
				capacity: at(85),
				thresholdPercent: 85,
			}),
		).toBe("alert");
		expect(
			capacityAlertChange({
				alerted: true,
				capacity: at(95),
				thresholdPercent: 85,
			}),
		).toBe("none");
		expect(
			capacityAlertChange({
				alerted: false,
				capacity: at(84),
				thresholdPercent: 85,
			}),
		).toBe("none");
	});

	test("recovers only once clearly below the threshold", () => {
		expect(
			capacityAlertChange({
				alerted: true,
				capacity: at(82),
				thresholdPercent: 85,
			}),
		).toBe("none");
		expect(
			capacityAlertChange({
				alerted: true,
				capacity: at(79),
				thresholdPercent: 85,
			}),
		).toBe("recovered");
	});
});
