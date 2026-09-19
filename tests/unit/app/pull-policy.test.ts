import { describe, expect, test } from "bun:test";
import { PULL_POLICIES } from "../../../src/lib/pull-policy";

describe("PULL_POLICIES", () => {
	test("always is first, so it's the default the picker lands on", () => {
		expect(PULL_POLICIES[0].value).toBe("always");
	});

	test("offers every policy the worker understands", () => {
		expect(PULL_POLICIES.map((p) => p.value)).toEqual([
			"always",
			"missing",
			"never",
		]);
	});
});
