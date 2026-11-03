import { describe, expect, test } from "bun:test";

import {
	isViewMode,
	storedViewMode,
	VIEW_MODE_KEY,
} from "../../../src/lib/view-modes";

describe("storedViewMode", () => {
	test("reads the account's choice for a list", () => {
		expect(storedViewMode({ stacks: "list" }, "stacks", "card")).toBe("list");
		expect(storedViewMode({ stacks: "card" }, "stacks", "list")).toBe("card");
	});

	test("falls back when nothing or something unknown is stored", () => {
		expect(storedViewMode({}, "stacks", "card")).toBe("card");
		expect(storedViewMode(null, "stacks", "list")).toBe("list");
		expect(storedViewMode({ stacks: "grid" }, "stacks", "list")).toBe("list");
	});
});

describe("isViewMode", () => {
	test("only knows list and card", () => {
		expect(isViewMode("list")).toBe(true);
		expect(isViewMode("card")).toBe(true);
		expect(isViewMode("table")).toBe(false);
		expect(isViewMode(undefined)).toBe(false);
	});
});

describe("VIEW_MODE_KEY", () => {
	test("takes a page's dashed key and refuses anything else", () => {
		expect(VIEW_MODE_KEY.test("build-cache-registries")).toBe(true);
		expect(VIEW_MODE_KEY.test("s3-destinations")).toBe(true);
		expect(VIEW_MODE_KEY.test("Stacks")).toBe(false);
		expect(VIEW_MODE_KEY.test("a--b")).toBe(false);
		expect(VIEW_MODE_KEY.test("__proto__")).toBe(false);
	});
});
