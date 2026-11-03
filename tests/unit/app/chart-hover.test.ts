import { describe, expect, test } from "bun:test";

import {
	bucketAt,
	clampX,
	clockLabel,
	entryX,
	nearestPoint,
	pointerRatio,
	stepIndex,
} from "../../../src/lib/chart-hover";
import { ChartHover } from "../../../src/lib/chart-hover.svelte";

describe("pointerRatio", () => {
	test("reads the pointer as a share of the element, clamped to its edges", () => {
		const rect = { left: 100, width: 200 };
		expect(pointerRatio(200, rect)).toBe(0.5);
		expect(pointerRatio(50, rect)).toBe(0);
		expect(pointerRatio(400, rect)).toBe(1);
		expect(pointerRatio(150, { left: 0, width: 0 })).toBe(0);
	});
});

describe("bucketAt", () => {
	test("picks the bar the share falls in, the last one at the right edge", () => {
		expect(bucketAt(0, 12)).toBe(0);
		expect(bucketAt(0.5, 12)).toBe(6);
		expect(bucketAt(1, 12)).toBe(11);
		expect(bucketAt(0.5, 0)).toBeNull();
	});
});

describe("nearestPoint", () => {
	test("snaps to the closest evenly spaced point", () => {
		expect(nearestPoint(0, 5)).toBe(0);
		expect(nearestPoint(0.6, 5)).toBe(2);
		expect(nearestPoint(0.9, 5)).toBe(4);
		expect(nearestPoint(0.5, 0)).toBeNull();
	});
});

describe("stepIndex", () => {
	test("moves with the arrows and jumps with Home and End", () => {
		expect(stepIndex("ArrowRight", 2, 5)).toBe(3);
		expect(stepIndex("ArrowRight", 4, 5)).toBe(4);
		expect(stepIndex("ArrowLeft", 0, 5)).toBe(0);
		expect(stepIndex("ArrowUp", 1, 5)).toBe(2);
		expect(stepIndex("ArrowDown", 1, 5)).toBe(0);
		expect(stepIndex("Home", 3, 5)).toBe(0);
		expect(stepIndex("End", 0, 5)).toBe(4);
	});

	test("starts from an end when nothing is highlighted", () => {
		expect(stepIndex("ArrowRight", null, 5)).toBe(0);
		expect(stepIndex("ArrowLeft", null, 5)).toBe(4);
	});

	test("ignores other keys and empty charts", () => {
		expect(stepIndex("Enter", 1, 5)).toBeUndefined();
		expect(stepIndex("ArrowRight", null, 0)).toBeUndefined();
	});
});

describe("entryX", () => {
	test("centres a bucket and places a point on its tick", () => {
		expect(entryX(0, 4, 400)).toBe(50);
		expect(entryX(3, 4, 400)).toBe(350);
		expect(entryX(0, 5, 400, true)).toBe(0);
		expect(entryX(4, 5, 400, true)).toBe(400);
		expect(entryX(0, 1, 400, true)).toBe(200);
		expect(entryX(0, 0, 400)).toBe(0);
	});
});

describe("clampX", () => {
	test("keeps a centred tooltip inside the chart", () => {
		expect(clampX(10, 400)).toBe(72);
		expect(clampX(390, 400)).toBe(328);
		expect(clampX(200, 400)).toBe(200);
		expect(clampX(10, 100)).toBe(50);
	});
});

describe("clockLabel", () => {
	test("formats a time of day with hours and minutes", () => {
		expect(clockLabel(new Date(2026, 0, 1, 9, 5))).toMatch(/09.05/);
	});
});

describe("ChartHover", () => {
	function pointer(clientX: number, pointerType = "mouse"): PointerEvent {
		return {
			clientX,
			currentTarget: {
				getBoundingClientRect: () => ({ left: 0, width: 100 }),
			},
			pointerType,
		} as unknown as PointerEvent;
	}

	function key(name: string): KeyboardEvent & { prevented: boolean } {
		const event = {
			key: name,
			prevented: false,
			preventDefault() {
				event.prevented = true;
			},
		};
		return event as unknown as KeyboardEvent & { prevented: boolean };
	}

	test("tracks the bucket under the pointer and positions the tooltip", () => {
		const hover = new ChartHover(() => 4);
		hover.width = 400;
		expect(hover.x).toBe(0);
		hover.track(pointer(80));
		expect(hover.index).toBe(3);
		expect(hover.x).toBe(328);
	});

	test("snaps to points on a line chart", () => {
		const hover = new ChartHover(() => 5, true);
		hover.track(pointer(60));
		expect(hover.index).toBe(2);
	});

	test("clears on a mouse leaving but keeps a touch", () => {
		const hover = new ChartHover(() => 4);
		hover.track(pointer(10, "touch"));
		hover.leave(pointer(10, "touch"));
		expect(hover.index).toBe(0);
		hover.leave(pointer(10));
		expect(hover.index).toBeNull();
	});

	test("moves with the keyboard and clears on demand", () => {
		const hover = new ChartHover(() => 3);
		const right = key("ArrowRight");
		hover.key(right);
		expect(right.prevented).toBe(true);
		expect(hover.index).toBe(0);
		const tab = key("Tab");
		hover.key(tab);
		expect(tab.prevented).toBe(false);
		expect(hover.index).toBe(0);
		hover.clear();
		expect(hover.index).toBeNull();
	});
});
