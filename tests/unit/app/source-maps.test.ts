import { describe, expect, test } from "bun:test";
import {
	addMapping,
	GenMapping,
	setSourceContent,
	toEncodedMap,
} from "@jridgewell/gen-mapping";
import type {
	StoredErrorEvent,
	StoredFrame,
} from "../../../src/lib/error-tracking/event";
import {
	applySourceMaps,
	isMinifiedFrame,
	mappedFileName,
	matchMapName,
	parseSourceMap,
	resolveFrame,
} from "../../../src/lib/error-tracking/source-maps";
import { readSourceMapUpload } from "../../../src/lib/server/source-map-upload";

const SOURCE = [
	"export function add(a, b) {",
	"  return a.b + b;",
	"}",
	"",
	"add(1, 2);",
].join("\n");

function mapJson(): string {
	const map = new GenMapping({ file: "app.js" });
	setSourceContent(map, "webpack://app/./src/lib/math.ts", SOURCE);
	addMapping(map, {
		generated: { column: 42, line: 1 },
		name: "add",
		original: { column: 9, line: 2 },
		source: "webpack://app/./src/lib/math.ts",
	});
	return JSON.stringify(toEncodedMap(map));
}

function frame(overrides: Partial<StoredFrame> = {}): StoredFrame {
	return {
		absPath: "https://app.example.com/_app/immutable/app.js",
		colno: 43,
		contextLine: null,
		filename: "/_app/immutable/app.js",
		function: "t",
		inApp: true,
		lineno: 1,
		module: null,
		postContext: [],
		preContext: [],
		...overrides,
	};
}

describe("source map names", () => {
	test("an upload path names the file it maps", () => {
		expect(mappedFileName("./_app/immutable/app.js.map")).toBe(
			"_app/immutable/app.js",
		);
		expect(mappedFileName("dist\\index.js.map")).toBe("dist/index.js");
	});

	test("a frame URL matches the longest map name its path ends with", () => {
		expect(
			matchMapName("https://app.example.com/_app/immutable/app.js?v=2", [
				"app.js",
				"_app/immutable/app.js",
				"other.js",
			]),
		).toBe("_app/immutable/app.js");
		expect(
			matchMapName("https://app.example.com/vendor.js", ["app.js"]),
		).toBeNull();
	});

	test("only frames served over http with a line are minified candidates", () => {
		expect(isMinifiedFrame(frame())).toBe(true);
		expect(isMinifiedFrame(frame({ absPath: "/app/src/index.ts" }))).toBe(
			false,
		);
		expect(isMinifiedFrame(frame({ lineno: null }))).toBe(false);
	});
});

describe("resolveFrame", () => {
	test("maps a minified position back to the source file, line, function and context", () => {
		const resolved = resolveFrame(frame(), parseSourceMap(mapJson()));
		expect(resolved).toMatchObject({
			absPath: "src/lib/math.ts",
			colno: 10,
			contextLine: "  return a.b + b;",
			filename: "src/lib/math.ts",
			function: "add",
			inApp: true,
			lineno: 2,
			postContext: ["}", "", "add(1, 2);"],
			preContext: ["export function add(a, b) {"],
		});
	});

	test("leaves a frame the map has no position for as sent", () => {
		const unmapped = frame({ colno: 1, lineno: 9 });
		expect(resolveFrame(unmapped, parseSourceMap(mapJson()))).toEqual(unmapped);
	});

	test("rejects anything but a version 3 map", () => {
		expect(() => parseSourceMap('{"version":2}')).toThrow("version 3");
	});
});

describe("applySourceMaps", () => {
	test("resolves the frames it has a map for and recomputes the culprit", () => {
		const event = {
			culprit: "t (/_app/immutable/app.js)",
			exceptions: [
				{
					frames: [
						frame({
							absPath: "https://app.example.com/vendor.js",
							function: "v",
						}),
						frame(),
					],
					handled: false,
					mechanism: null,
					module: null,
					type: "TypeError",
					value: "a is undefined",
				},
			],
		} as unknown as StoredErrorEvent;
		const mapped = applySourceMaps(
			event,
			new Map([["_app/immutable/app.js", parseSourceMap(mapJson())]]),
		);
		expect(mapped.exceptions[0]?.frames[0]?.function).toBe("v");
		expect(mapped.exceptions[0]?.frames[1]?.function).toBe("add");
		expect(mapped.culprit).toBe("add (src/lib/math.ts)");
	});
});

describe("readSourceMapUpload", () => {
	test("keys each map by its path, falling back to the file name", async () => {
		const form = new FormData();
		form.set("release", "abc123");
		form.set("_app/app.js.map", new File([mapJson()], "app.js.map"));
		form.set("file", new File([mapJson()], "vendor.js.map"));
		const upload = await readSourceMapUpload(form);
		expect(upload.error).toBeNull();
		expect(upload.release).toBe("abc123");
		expect(upload.files?.map((file) => file.name)).toEqual([
			"_app/app.js",
			"vendor.js",
		]);
	});

	test("refuses a missing release, no files or a file that isn't a source map", async () => {
		const noRelease = new FormData();
		noRelease.set("file", new File([mapJson()], "a.js.map"));
		expect((await readSourceMapUpload(noRelease)).error).toContain("release");

		const noFiles = new FormData();
		noFiles.set("release", "abc");
		expect((await readSourceMapUpload(noFiles)).error).toContain(".map");

		const bad = new FormData();
		bad.set("release", "abc");
		bad.set("file", new File(["nope"], "a.js.map"));
		expect((await readSourceMapUpload(bad)).error).toContain("version 3");
	});
});
