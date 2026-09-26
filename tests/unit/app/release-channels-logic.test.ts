import { describe, expect, test } from "bun:test";
import {
	canarySlug,
	deployEnvironment,
	environmentLabel,
	matchesTagPattern,
	tagPatternProblem,
} from "../../../src/lib/release-channels";

describe("release channels", () => {
	test("a service's environment: canary, preview or production", () => {
		expect(
			deployEnvironment({ channelCanary: true, previewParentId: null }),
		).toBe("canary");
		expect(
			deployEnvironment({ channelCanary: false, previewParentId: "p" }),
		).toBe("preview");
		expect(
			deployEnvironment({ channelCanary: false, previewParentId: null }),
		).toBe("production");
	});

	test("known environments get a label, custom ones read as is", () => {
		expect(environmentLabel("canary")).toBe("Canary");
		expect(environmentLabel("production")).toBe("Production");
		expect(environmentLabel("staging")).toBe("staging");
	});

	test("tag globs: * any run, ? one character, the rest literal", () => {
		expect(matchesTagPattern("v*", "v1.2.3")).toBe(true);
		expect(matchesTagPattern("v*", "release-1")).toBe(false);
		expect(matchesTagPattern("release/*", "release/2026/09")).toBe(true);
		expect(matchesTagPattern("v?.0", "v2.0")).toBe(true);
		expect(matchesTagPattern("v?.0", "v10.0")).toBe(false);
		expect(matchesTagPattern("v1.0", "v1x0")).toBe(false);
		expect(matchesTagPattern("(v)+", "(v)+")).toBe(true);
	});

	test("the canary slug stays one DNS label", () => {
		expect(canarySlug("web")).toBe("web-canary");
		const long = canarySlug(`${"a".repeat(55)}---${"b".repeat(10)}`);
		expect(long.length).toBeLessThanOrEqual(63);
		expect(long.endsWith("-canary")).toBe(true);
		expect(long).not.toContain("--canary");
	});

	test("a tag pattern must be non-blank and without spaces", () => {
		expect(tagPatternProblem("v*")).toBeNull();
		expect(tagPatternProblem("  ")).toContain("Enter a tag pattern");
		expect(tagPatternProblem("v *")).toContain("spaces");
	});
});
