import { describe, expect, test } from "bun:test";
import {
	describeIncidentEvent,
	formatDuration,
	parseAlertTiming,
	ResourceIncidentTracker,
} from "../../../src/lib/resource-incidents";
import {
	DEFAULT_THRESHOLDS,
	levelFor,
	type ResourceReading,
} from "../../../src/lib/resource-thresholds";

function reading(
	kind: ResourceReading["kind"],
	percent: number,
): ResourceReading {
	const threshold = DEFAULT_THRESHOLDS[kind];
	return { kind, level: levelFor(percent, threshold), percent, threshold };
}

const TIMING = { reminderMs: 30 * 60_000, sustainMs: 60_000 };
const MIN = 60_000;

function types(
	tracker: ResourceIncidentTracker,
	readings: ResourceReading[],
	now: number,
) {
	return tracker
		.next(readings, now, TIMING)
		.map((event) => `${event.reading.kind}:${event.type}`);
}

describe("ResourceIncidentTracker", () => {
	test("opens only once a breach has lasted the sustain window, and a dip resets it", () => {
		const tracker = new ResourceIncidentTracker();
		expect(types(tracker, [reading("cpu", 90)], 0)).toEqual([]);
		expect(types(tracker, [reading("cpu", 90)], 30_000)).toEqual([]);
		expect(types(tracker, [reading("cpu", 40)], 45_000)).toEqual([]);
		expect(types(tracker, [reading("cpu", 90)], MIN)).toEqual([]);
		expect(types(tracker, [reading("cpu", 90)], 2 * MIN)).toEqual(["cpu:open"]);
	});

	test("a disk opens on the first breach", () => {
		expect(
			types(new ResourceIncidentTracker(), [reading("disk", 90)], 0),
		).toEqual(["disk:open"]);
	});

	test("escalates to hard, reminds while open, recovers once, tracking the peak", () => {
		const tracker = new ResourceIncidentTracker();
		tracker.next([reading("memory", 88)], 0, TIMING);
		expect(types(tracker, [reading("memory", 88)], MIN)).toEqual([
			"memory:open",
		]);
		expect(types(tracker, [reading("memory", 97)], 2 * MIN)).toEqual([
			"memory:escalate",
		]);
		expect(types(tracker, [reading("memory", 90)], 20 * MIN)).toEqual([]);
		expect(types(tracker, [reading("memory", 90)], 33 * MIN)).toEqual([
			"memory:remind",
		]);
		expect(tracker.open()[0]?.peak).toBe(97);
		const [recovery] = tracker.next([reading("memory", 50)], 40 * MIN, TIMING);
		expect(recovery?.type).toBe("recover");
		expect(describeIncidentEvent(recovery as never, 40 * MIN)).toBe(
			"Memory back to 50% after 40 min (peak 97%)",
		);
		expect(types(tracker, [reading("memory", 50)], 41 * MIN)).toEqual([]);
	});

	test("never reminds when the interval is 0, and a restored incident recovers without opening again", () => {
		const tracker = new ResourceIncidentTracker();
		tracker.restore([
			{
				id: "i1",
				kind: "cpu",
				lastNotifiedAt: 0,
				level: "soft",
				peak: 91,
				startedAt: 0,
			},
		]);
		expect(
			tracker.next([reading("cpu", 90)], 999 * MIN, {
				...TIMING,
				reminderMs: 0,
			}),
		).toEqual([]);
		expect(types(tracker, [reading("cpu", 30)], 1000 * MIN)).toEqual([
			"cpu:recover",
		]);
	});

	test("a resource a reading leaves out keeps its incident", () => {
		const tracker = new ResourceIncidentTracker();
		tracker.next([reading("disk", 90)], 0, TIMING);
		expect(types(tracker, [reading("cpu", 10)], MIN)).toEqual([]);
		expect(tracker.open().map((incident) => incident.kind)).toEqual(["disk"]);
	});
});

describe("formatDuration", () => {
	test("seconds, minutes, hours, days", () => {
		expect(formatDuration(45_000)).toBe("45s");
		expect(formatDuration(12 * MIN)).toBe("12 min");
		expect(formatDuration(185 * MIN)).toBe("3 h 5 min");
		expect(formatDuration(120 * MIN)).toBe("2 h");
		expect(formatDuration(52 * 60 * MIN)).toBe("2 d 4 h");
		expect(formatDuration(48 * 60 * MIN)).toBe("2 d");
	});
});

describe("parseAlertTiming", () => {
	const form = (values: Record<string, string>) => (name: string) =>
		values[name] ?? null;

	test("reads both, 0 allowed", () => {
		expect(
			parseAlertTiming(form({ reminderMinutes: "0", sustainSeconds: "60" })),
		).toEqual({
			reminderMinutes: 0,
			sustainSeconds: 60,
		});
	});

	test("refuses anything out of range or not whole", () => {
		expect(
			parseAlertTiming(form({ reminderMinutes: "30", sustainSeconds: "7200" })),
		).toContain("seconds");
		expect(
			parseAlertTiming(form({ reminderMinutes: "1.5", sustainSeconds: "60" })),
		).toContain("minutes");
	});
});
