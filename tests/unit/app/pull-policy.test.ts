import { describe, expect, test } from "bun:test";
import { PULL_POLICIES, shouldSkipPull } from "../../../src/lib/pull-policy";

describe("shouldSkipPull", () => {
	test("always pulls, whether or not the image is already here", () => {
		expect(shouldSkipPull("always", true)).toBeNull();
		expect(shouldSkipPull("always", false)).toBeNull();
	});

	test("missing pulls only when the image isn't here", () => {
		expect(shouldSkipPull("missing", false)).toBeNull();
		expect(shouldSkipPull("missing", true)).toContain("already on this host");
	});

	test("never pulls either way, and says so when the image is absent", () => {
		expect(shouldSkipPull("never", true)).toContain("already on this host");
		expect(shouldSkipPull("never", false)).toContain("isn't on this host");
	});
});

describe("PULL_POLICIES", () => {
	test("always is first, so it's the default the picker lands on", () => {
		expect(PULL_POLICIES[0].value).toBe("always");
	});

	test("every policy the helper understands has an option", () => {
		const values = PULL_POLICIES.map((p) => p.value);
		expect(values).toEqual(["always", "missing", "never"]);
		for (const value of values) {
			expect(typeof shouldSkipPull(value, true)).not.toBe("undefined");
		}
	});
});
