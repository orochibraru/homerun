import { describe, expect, test } from "bun:test";
import {
	hasIconImage,
	iconProblem,
	iconSrc,
	MAX_ICON_BYTES,
} from "$lib/service-icon";

const png = (bytes: number) =>
	`data:image/png;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;

describe("hasIconImage and iconSrc", () => {
	test("tell a picture from the generic category icon", () => {
		expect(hasIconImage("redis.svg")).toBe(true);
		expect(hasIconImage(png(10))).toBe(true);
		expect(hasIconImage("")).toBe(false);
		expect(hasIconImage(null)).toBe(false);
	});

	test("serve a bundled file from template-icons and an upload as is", () => {
		expect(iconSrc("redis.svg")).toBe("/template-icons/redis.svg");
		expect(iconSrc(png(10))).toBe(png(10));
	});
});

describe("iconProblem", () => {
	const bundled = ["redis.svg", "nuvio.png"];

	test("accepts no icon, a bundled one and a small upload", () => {
		expect(iconProblem("", bundled)).toBeNull();
		expect(iconProblem("redis.svg", bundled)).toBeNull();
		expect(iconProblem(png(1024), bundled)).toBeNull();
		expect(
			iconProblem("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", bundled),
		).toBeNull();
	});

	test("refuses a file outside the library, including a path", () => {
		expect(iconProblem("unknown.svg", bundled)).toContain("library");
		expect(iconProblem("../../etc/passwd", bundled)).toContain("library");
		expect(iconProblem("https://evil.example/x.png", bundled)).toContain(
			"library",
		);
	});

	test("refuses a non-image or malformed upload, and an oversized one", () => {
		expect(
			iconProblem("data:text/html;base64,PGgxPmhpPC9oMT4=", bundled),
		).toContain("Upload");
		expect(iconProblem("data:image/png;base64,not base64!", bundled)).toContain(
			"Upload",
		);
		expect(iconProblem(png(MAX_ICON_BYTES + 1024), bundled)).toContain("KB");
	});
});
