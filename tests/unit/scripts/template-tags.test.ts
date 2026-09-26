import { describe, expect, test } from "bun:test";
import {
	compareNumbers,
	isStableVersion,
	newestStableTag,
	nextPageUrl,
	parseTag,
	replaceTag,
} from "../../../scripts/template-tags";

describe("parseTag", () => {
	test("splits prefix, numbers and suffix", () => {
		expect(parseTag("18-alpine")).toEqual({
			numbers: [18],
			prefix: "",
			suffix: "-alpine",
		});
		expect(parseTag("v1.2.3")).toEqual({
			numbers: [1, 2, 3],
			prefix: "v",
			suffix: "",
		});
	});

	test("returns null for floating tags", () => {
		for (const tag of [
			"latest",
			"stable",
			"alpine",
			"main",
			"postgresql-latest",
		]) {
			expect(parseTag(tag)).toBeNull();
		}
	});
});

describe("isStableVersion", () => {
	test("accepts pinned versions and variant suffixes", () => {
		for (const tag of ["7", "8-alpine", "1.2.3", "v2.0", "18-bookworm"]) {
			expect(isStableVersion(tag)).toBe(true);
		}
	});

	test("rejects pre-releases and floating channels", () => {
		for (const tag of [
			"latest",
			"19rc1-alpine",
			"2.0.0-beta.3",
			"1.0-alpha",
			"3-nightly",
			"4-dev",
			"5-edge",
			"8.0-latest",
		]) {
			expect(isStableVersion(tag)).toBe(false);
		}
	});
});

describe("compareNumbers", () => {
	test("orders numerically, not lexically", () => {
		expect(compareNumbers([10], [9])).toBeGreaterThan(0);
		expect(compareNumbers([1, 2, 10], [1, 2, 9])).toBeGreaterThan(0);
		expect(compareNumbers([1, 2], [1, 2])).toBe(0);
		expect(compareNumbers([1, 1], [1, 2])).toBeLessThan(0);
	});
});

describe("newestStableTag", () => {
	const postgres = [
		"17-alpine",
		"18-alpine",
		"19-alpine",
		"19.1-alpine",
		"20beta1-alpine",
		"19",
		"latest",
		"alpine",
	];

	test("keeps the NN-alpine shape", () => {
		expect(newestStableTag("18-alpine", postgres)).toBe("19-alpine");
	});

	test("keeps a bare major bare", () => {
		expect(
			newestStableTag("7", ["7", "8", "8.0", "8.0.1", "9-rc", "latest"]),
		).toBe("8");
	});

	test("keeps full semver full and ignores pre-releases", () => {
		expect(
			newestStableTag("1.2.3", [
				"1.2.3",
				"1.2.10",
				"1.3.0-rc1",
				"1.3",
				"v1.4.0",
			]),
		).toBe("1.2.10");
	});

	test("never downgrades and returns null when nothing is newer", () => {
		expect(newestStableTag("18-alpine", ["16-alpine", "18-alpine"])).toBeNull();
	});

	test("leaves floating and pre-release tags alone", () => {
		expect(newestStableTag("latest", ["1", "2"])).toBeNull();
		expect(newestStableTag("2.0-beta", ["2.0", "3.0"])).toBeNull();
	});

	test("ignores date stamps posing as a newer major", () => {
		expect(newestStableTag("7", ["8", "20240101", "1000"])).toBe("8");
		expect(newestStableTag("9", ["10", "26"])).toBe("26");
	});
});

describe("replaceTag", () => {
	const file =
		'{\n\t"image": "postgres",\n\t"tag": "18-alpine",\n\t"tags": ["sql"]\n}\n';

	test("rewrites only the tag field and keeps formatting", () => {
		expect(replaceTag(file, "18-alpine", "19-alpine")).toBe(
			'{\n\t"image": "postgres",\n\t"tag": "19-alpine",\n\t"tags": ["sql"]\n}\n',
		);
	});

	test("throws when the tag isn't there exactly once", () => {
		expect(() => replaceTag(file, "17-alpine", "19-alpine")).toThrow();
	});
});

describe("nextPageUrl", () => {
	test("resolves the next link against the registry", () => {
		expect(
			nextPageUrl(
				'</v2/library/postgres/tags/list?last=17&n=1000>; rel="next"',
				"https://registry-1.docker.io/v2/library/postgres/tags/list?n=1000",
			),
		).toBe(
			"https://registry-1.docker.io/v2/library/postgres/tags/list?last=17&n=1000",
		);
	});

	test("returns null on the last page", () => {
		expect(nextPageUrl(null, "https://ghcr.io/v2/x/tags/list")).toBeNull();
	});
});
