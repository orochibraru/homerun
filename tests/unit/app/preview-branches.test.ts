import { describe, expect, test } from "bun:test";
import {
	branchPatternProblem,
	parseBranchPatterns,
	previewBranchAllowed,
} from "../../../src/lib/preview-branches";

describe("parseBranchPatterns", () => {
	test("splits on lines and commas, trims and drops blanks and duplicates", () => {
		expect(parseBranchPatterns(" feat/* \n\nfix/*, feat/*,")).toEqual([
			"feat/*",
			"fix/*",
		]);
	});
});

describe("branchPatternProblem", () => {
	test("refuses whitespace and very long patterns", () => {
		expect(branchPatternProblem("feat/*")).toBeNull();
		expect(branchPatternProblem("a b")).toContain("whitespace");
		expect(branchPatternProblem("x".repeat(201))).toContain("200");
	});
});

describe("previewBranchAllowed", () => {
	test("no filter lets everything through, even an unknown branch", () => {
		expect(previewBranchAllowed("anything", [], [])).toBe(true);
		expect(previewBranchAllowed(null, [], [])).toBe(true);
	});

	test("include needs a match, exclude wins, globs cross slashes", () => {
		expect(previewBranchAllowed("feat/a/b", ["feat/*"], [])).toBe(true);
		expect(previewBranchAllowed("main", ["feat/*"], [])).toBe(false);
		expect(previewBranchAllowed("feat/wip", ["feat/*"], ["*/wip"])).toBe(false);
		expect(previewBranchAllowed("fix-1", [], ["fix-?"])).toBe(false);
		expect(previewBranchAllowed("fix-12", [], ["fix-?"])).toBe(true);
		expect(previewBranchAllowed(null, [], ["x"])).toBe(false);
	});
});
