import { describe, expect, test } from "bun:test";
import {
	matchesWatchPath,
	parseWatchPaths,
	pushMatchesWatchPaths,
} from "../../../src/lib/watch-paths";

describe("parseWatchPaths", () => {
	test("one trimmed pattern per line, without blanks or duplicates", () => {
		expect(parseWatchPaths(" apps/api/** \n\n*.md\napps/api/**\n")).toEqual([
			"apps/api/**",
			"*.md",
		]);
	});
});

describe("matchesWatchPath", () => {
	test("a pattern with a slash matches from the repo root", () => {
		expect(matchesWatchPath("apps/api/**", "apps/api/src/main.ts")).toBe(true);
		expect(matchesWatchPath("apps/api/**", "apps/web/src/main.ts")).toBe(false);
		expect(
			matchesWatchPath("apps/*/package.json", "apps/web/package.json"),
		).toBe(true);
		expect(matchesWatchPath("src/*.ts", "lib/src/a.ts")).toBe(false);
	});

	test("a folder path covers everything under it", () => {
		expect(matchesWatchPath("docs", "docs/guide/intro.md")).toBe(true);
		expect(matchesWatchPath("packages/shared/", "packages/shared/a.ts")).toBe(
			true,
		);
		expect(matchesWatchPath("docs", "documentation/a.md")).toBe(false);
	});

	test("a pattern without a slash matches a file name at any depth", () => {
		expect(matchesWatchPath("*.md", "README.md")).toBe(true);
		expect(matchesWatchPath("*.md", "docs/guide/intro.md")).toBe(true);
		expect(matchesWatchPath("Dockerfile", "apps/api/Dockerfile")).toBe(true);
		expect(matchesWatchPath("*.md", "apps/api/main.ts")).toBe(false);
	});

	test("dotfiles and brace sets match", () => {
		expect(matchesWatchPath(".github/**", ".github/workflows/ci.yml")).toBe(
			true,
		);
		expect(matchesWatchPath("apps/{api,web}/**", "apps/web/a.ts")).toBe(true);
	});
});

describe("pushMatchesWatchPaths", () => {
	const files = ["apps/web/page.ts", "README.md"];

	test("no patterns or no file list always deploys", () => {
		expect(pushMatchesWatchPaths(files, { ignore: [], watch: [] })).toBe(true);
		expect(
			pushMatchesWatchPaths(null, { ignore: ["**"], watch: ["nothing/**"] }),
		).toBe(true);
	});

	test("needs one changed file matching a watch path", () => {
		expect(
			pushMatchesWatchPaths(files, { ignore: [], watch: ["apps/web/**"] }),
		).toBe(true);
		expect(
			pushMatchesWatchPaths(files, { ignore: [], watch: ["apps/api/**"] }),
		).toBe(false);
	});

	test("ignore paths alone deploy on any other file", () => {
		expect(pushMatchesWatchPaths(files, { ignore: ["*.md"], watch: [] })).toBe(
			true,
		);
		expect(
			pushMatchesWatchPaths(["README.md", "docs/a.md"], {
				ignore: ["*.md"],
				watch: [],
			}),
		).toBe(false);
	});

	test("an ignored file doesn't count even when watched", () => {
		expect(
			pushMatchesWatchPaths(["apps/web/README.md"], {
				ignore: ["*.md"],
				watch: ["apps/web/**"],
			}),
		).toBe(false);
		expect(
			pushMatchesWatchPaths(["apps/web/README.md", "apps/web/page.ts"], {
				ignore: ["*.md"],
				watch: ["apps/web/**"],
			}),
		).toBe(true);
	});
});
