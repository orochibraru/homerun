import { describe, expect, test } from "bun:test";

import {
	buildLane,
	LANE_BUCKET_SECONDS,
	LANE_BUCKETS,
	laneHue,
	laneStart,
	stackHues,
} from "../../../src/lib/lanes";

const now = new Date("2026-10-31T15:55:00Z");
const first = Math.floor(laneStart(now).getTime() / 1000 / LANE_BUCKET_SECONDS);

describe("laneStart", () => {
	test("starts 47 half-hour buckets before the one now falls in", () => {
		expect(laneStart(now).toISOString()).toBe("2026-10-30T16:00:00.000Z");
	});
});

describe("buildLane", () => {
	test("places traffic in its bucket and drops what's outside the day", () => {
		const lane = buildLane(
			[
				{ bucket: first, durationMs: 100, errors: 1, requests: 10 },
				{
					bucket: first + LANE_BUCKETS - 1,
					durationMs: 50,
					errors: 0,
					requests: 5,
				},
				{ bucket: first - 1, errors: 0, requests: 99 },
				{ bucket: first + LANE_BUCKETS, errors: 0, requests: 99 },
			],
			[],
			now,
		);
		expect(lane.requests).toHaveLength(LANE_BUCKETS);
		expect(lane.requests[0]).toBe(10);
		expect(lane.errors[0]).toBe(1);
		expect(lane.requests[LANE_BUCKETS - 1]).toBe(5);
		expect(lane.requests.reduce((a, b) => a + b, 0)).toBe(15);
		expect(lane.avgResponseMs).toBe(10);
	});

	test("marks deploys by bucket and flags failed ones", () => {
		const lane = buildLane(
			[],
			[
				{ createdAt: new Date("2026-10-31T15:40:00Z"), status: "running" },
				{ createdAt: new Date("2026-10-31T09:10:00Z"), status: "failed" },
				{ createdAt: new Date("2026-10-29T09:10:00Z"), status: "running" },
			],
			now,
		);
		expect(lane.avgResponseMs).toBeNull();
		expect(lane.deploys).toEqual([
			{ failed: false, index: LANE_BUCKETS - 1 },
			{ failed: true, index: 34 },
		]);
	});
});

describe("laneHue", () => {
	test("cycles through the four lane colours", () => {
		expect(laneHue(0)).toBe("var(--lane-0)");
		expect(laneHue(5)).toBe("var(--lane-1)");
		expect(laneHue(-1)).toBe("var(--lane-3)");
	});
});

describe("stackHues", () => {
	test("gives top-level stacks their own hue and substacks their root's", () => {
		const hues = stackHues([
			{ id: "apps", parentId: null },
			{ id: "sites", parentId: null },
			{ id: "apps-db", parentId: "apps" },
			{ id: "deep", parentId: "apps-db" },
			{ id: "orphan", parentId: "gone" },
		]);
		expect(hues.get("apps")).toBe("var(--lane-0)");
		expect(hues.get("sites")).toBe("var(--lane-1)");
		expect(hues.get("apps-db")).toBe("var(--lane-0)");
		expect(hues.get("deep")).toBe("var(--lane-0)");
		expect(hues.get("orphan")).toBe("var(--lane-2)");
	});
});
