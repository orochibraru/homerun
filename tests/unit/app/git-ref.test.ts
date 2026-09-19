import { describe, expect, test } from "bun:test";
import { isCommitSha, pollOutcome } from "../../../src/lib/git-ref";

const sha = "68c1b9e0f1a2b3c4d5e6f708192a3b4c5d6e7f80";

describe("isCommitSha", () => {
	test("accepts a full SHA in either case", () => {
		expect(isCommitSha(sha)).toBe(true);
		expect(isCommitSha(sha.toUpperCase())).toBe(true);
	});

	test("rejects branches, tags and short SHAs", () => {
		expect(isCommitSha("main")).toBe(false);
		expect(isCommitSha("v1.2.3")).toBe(false);
		expect(isCommitSha("68c1b9e")).toBe(false);
		expect(isCommitSha(null)).toBe(false);
		expect(isCommitSha("")).toBe(false);
	});
});

describe("pollOutcome", () => {
	const head = "a".repeat(40);

	test("the first head seen is only recorded", () => {
		expect(pollOutcome(null, head)).toBe("baseline");
	});

	test("a moved branch deploys, an unmoved one doesn't", () => {
		expect(pollOutcome("b".repeat(40), head)).toBe("deploy");
		expect(pollOutcome(head.toUpperCase(), head)).toBe("unchanged");
	});
});
