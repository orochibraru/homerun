import { describe, expect, test } from "bun:test";
import {
	type HighlightLanguage,
	languageFor,
	loadHighlighter,
} from "$lib/highlight";

describe("languageFor", () => {
	test("maps extensions, Dockerfiles and dotfiles", () => {
		expect(languageFor("conf.d/default.conf")).toBe("nginx");
		expect(languageFor("app/config.YML")).toBe("yaml");
		expect(languageFor("Dockerfile")).toBe("dockerfile");
		expect(languageFor("build/Dockerfile.prod")).toBe("dockerfile");
		expect(languageFor(".env")).toBe("bash");
		expect(languageFor("README")).toBeNull();
		expect(languageFor("data.bin")).toBeNull();
	});
});

describe("loadHighlighter", () => {
	test("returns escaped, classed HTML and registers a language once", async () => {
		const yaml = await loadHighlighter("yaml");
		const html = yaml("key: <value> # note");
		expect(html).toContain('<span class="hljs-attr">key:</span>');
		expect(html).toContain("&lt;value&gt;");
		expect(html).toContain("hljs-comment");
		const again = await loadHighlighter("yaml");
		expect(again("a: 1")).toContain("hljs-number");
	});
});

test("every language's grammar loads", async () => {
	const all: HighlightLanguage[] = [
		"bash",
		"css",
		"dockerfile",
		"go",
		"ini",
		"java",
		"javascript",
		"json",
		"lua",
		"markdown",
		"nginx",
		"php",
		"properties",
		"python",
		"ruby",
		"rust",
		"sql",
		"typescript",
		"xml",
		"yaml",
	];
	for (const language of all) {
		const highlight = await loadHighlighter(language);
		expect(typeof highlight("x")).toBe("string");
	}
});
