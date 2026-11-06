import { describe, expect, test } from "bun:test";

import {
	breadcrumbText,
	cleanCulprit,
	framePath,
	linkify,
	shortRelease,
} from "../../../src/lib/error-tracking/display";
import type {
	StoredBreadcrumb,
	StoredFrame,
} from "../../../src/lib/error-tracking/event";

function frame(filename: string, lineno: number | null = 12): StoredFrame {
	return {
		absPath: null,
		colno: lineno ? 8 : null,
		contextLine: null,
		filename,
		function: "handler",
		inApp: true,
		lineno,
		module: null,
		postContext: [],
		preContext: [],
	} as StoredFrame;
}

function crumb(message: string | null): StoredBreadcrumb {
	return {
		category: "http",
		level: null,
		message,
		timestamp: null,
		type: null,
	};
}

describe("framePath", () => {
	test("strips SvelteKit build output noise and splits the file name", () => {
		const path = framePath(
			frame(
				"../.svelte-kit/output/server/entries/endpoints/admin/connect/_server.ts.js",
			),
		);
		expect(path.dir).toBe("entries/endpoints/admin/connect/");
		expect(path.base).toBe("_server.ts.js");
		expect(path.line).toBe(":12:8");
	});

	test("strips node_modules and file:// prefixes", () => {
		expect(
			framePath(frame("file:///app/node_modules/hono/dist/x.js")).dir,
		).toBe("hono/dist/");
	});

	test("keeps a bare file name and no line", () => {
		const path = framePath(frame("main.js", null));
		expect(path).toMatchObject({ base: "main.js", dir: "", line: "" });
	});
});

describe("breadcrumbText", () => {
	test("reads an HTTP crumb's JSON as method, URL and status", () => {
		expect(
			breadcrumbText(
				crumb(
					'{"status_code":200,"url":"http://otel:4318/v1/traces","http.request.method":"POST"}',
				),
			),
		).toBe("POST http://otel:4318/v1/traces → 200");
	});

	test("flattens other JSON and keeps plain text", () => {
		expect(breadcrumbText(crumb('{"a":1,"b":{"c":2}}'))).toBe('a=1  b={"c":2}');
		expect(breadcrumbText(crumb("Listening on :3000"))).toBe(
			"Listening on :3000",
		);
		expect(breadcrumbText(crumb("{not json"))).toBe("{not json");
		expect(breadcrumbText(crumb(null))).toBe("");
	});
});

describe("shortRelease", () => {
	test("shortens long hashes only", () => {
		expect(shortRelease("1aca1c1657a3d79b9a2d5778ade0bb08c16e33e5")).toBe(
			"1aca1c1",
		);
		expect(shortRelease("v1.2.3")).toBe("v1.2.3");
		expect(shortRelease(null)).toBe("-");
	});
});

describe("linkify", () => {
	test("splits URLs out of text", () => {
		expect(linkify("see https://svelte.dev/e/kit now")).toEqual([
			{ href: null, text: "see " },
			{ href: "https://svelte.dev/e/kit", text: "https://svelte.dev/e/kit" },
			{ href: null, text: " now" },
		]);
		expect(linkify("plain")).toEqual([{ href: null, text: "plain" }]);
	});
});

describe("cleanCulprit", () => {
	test("strips build noise from the path in parentheses", () => {
		expect(
			cleanCulprit(
				"redirect_external_not_in_allowlist (../.svelte-kit/output/server/chunks/exports.js)",
			),
		).toBe("redirect_external_not_in_allowlist (chunks/exports.js)");
		expect(cleanCulprit("GET /admin")).toBe("GET /admin");
	});
});
