import { describe, expect, test } from "bun:test";
import {
	contentChunks,
	isEditableText,
	normalizeVolumePath,
	parentPath,
	parseListing,
} from "$lib/volume-files";

describe("normalizeVolumePath", () => {
	test("drops dots and extra slashes", () => {
		expect(normalizeVolumePath("/conf.d//./nginx.conf/")).toBe(
			"conf.d/nginx.conf",
		);
		expect(normalizeVolumePath("")).toBe("");
	});

	test("refuses anything that climbs out or smuggles a NUL", () => {
		expect(normalizeVolumePath("../etc/passwd")).toBeNull();
		expect(normalizeVolumePath("conf/../../x")).toBeNull();
		expect(normalizeVolumePath("a\0b")).toBeNull();
	});

	test("finds the parent", () => {
		expect(parentPath("a/b/c")).toBe("a/b");
		expect(parentPath("a")).toBe("");
	});
});

describe("parseListing", () => {
	test("reads stat lines, directories first, names with pipes intact", () => {
		const entries = parseListing(
			[
				"regular file|12|1700000000|./z.conf",
				"directory|4096|1700000000|conf.d",
				"regular empty file|0|1700000000|weird|name",
				"symbolic link|7|1700000000|latest",
				"",
			].join("\n"),
		);
		expect(entries.map((e) => [e.kind, e.name])).toEqual([
			["directory", "conf.d"],
			["link", "latest"],
			["file", "weird|name"],
			["file", "z.conf"],
		]);
		expect(entries[3]?.size).toBe(12);
		expect(entries[0]?.modifiedAt).toBe("2023-11-14T22:13:20.000Z");
	});
});

describe("isEditableText and contentChunks", () => {
	test("tell text from binary", () => {
		expect(isEditableText(new TextEncoder().encode("server { }"))).toBe(true);
		expect(isEditableText(new Uint8Array([0x89, 0x50, 0x00]))).toBe(false);
		expect(isEditableText(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(false);
	});

	test("split content into env-sized base64 chunks that join back", () => {
		const content = "é".repeat(100_000);
		const chunks = contentChunks(content);
		expect(Object.keys(chunks).length).toBeGreaterThan(1);
		expect(Object.values(chunks).every((c) => c.length <= 96 * 1024)).toBe(
			true,
		);
		const joined = Object.keys(chunks)
			.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
			.map((k) => chunks[k])
			.join("");
		expect(Buffer.from(joined, "base64").toString("utf8")).toBe(content);
		expect(contentChunks("")).toEqual({});
	});
});
