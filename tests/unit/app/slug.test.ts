import { describe, expect, test } from "bun:test";
import {
	stackScopedSlug,
	suffixedSlug,
	uniqueSlug,
} from "../../../src/lib/slug";

function takenSet(...slugs: string[]): (slug: string) => Promise<boolean> {
	const taken = new Set(slugs);
	return (slug) => Promise.resolve(taken.has(slug));
}

describe("suffixedSlug", () => {
	test("appends the attempt number", () => {
		expect(suffixedSlug("app", 2)).toBe("app-2");
	});

	test("truncates a long base so the suffix still fits in 63 characters", () => {
		const slug = suffixedSlug("a".repeat(63), 12);
		expect(slug).toHaveLength(63);
		expect(slug.endsWith("-12")).toBe(true);
	});

	test("never leaves a doubled hyphen after truncation", () => {
		expect(suffixedSlug(`${"a".repeat(60)}-bbb`, 2)).toBe(
			`${"a".repeat(60)}-2`,
		);
	});

	test("uses the bare attempt number for an empty base", () => {
		expect(suffixedSlug("", 3)).toBe("3");
	});
});

describe("uniqueSlug", () => {
	test("keeps a free base", async () => {
		expect(await uniqueSlug("app", takenSet())).toBe("app");
	});

	test("counts up from 2 past taken candidates", async () => {
		expect(await uniqueSlug("app", takenSet("app", "app-2", "app-3"))).toBe(
			"app-4",
		);
	});

	test("terminates for a taken 63-character base", async () => {
		const base = "a".repeat(63);
		const slug = await uniqueSlug(base, takenSet(base));
		expect(slug).toBe(`${"a".repeat(61)}-2`);
	});
});

describe("stackScopedSlug", () => {
	test("a service created in a stack is prefixed with the stack's slug, once", () => {
		expect(stackScopedSlug("vortex", "redis")).toBe("vortex-redis");
		expect(stackScopedSlug("vortex", "vortex-redis")).toBe("vortex-redis");
		expect(stackScopedSlug("vortex", "vortex")).toBe("vortex");
		expect(stackScopedSlug(null, "redis")).toBe("redis");
		expect(stackScopedSlug("a".repeat(40), "b".repeat(40))).toHaveLength(63);
	});
});
