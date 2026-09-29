import type { LanguageFn } from "highlight.js";

type Loader = () => Promise<{ default: LanguageFn }>;

const LANGUAGES = {
	bash: () => import("highlight.js/lib/languages/bash"),
	css: () => import("highlight.js/lib/languages/css"),
	dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
	go: () => import("highlight.js/lib/languages/go"),
	ini: () => import("highlight.js/lib/languages/ini"),
	java: () => import("highlight.js/lib/languages/java"),
	javascript: () => import("highlight.js/lib/languages/javascript"),
	json: () => import("highlight.js/lib/languages/json"),
	lua: () => import("highlight.js/lib/languages/lua"),
	markdown: () => import("highlight.js/lib/languages/markdown"),
	nginx: () => import("highlight.js/lib/languages/nginx"),
	php: () => import("highlight.js/lib/languages/php"),
	properties: () => import("highlight.js/lib/languages/properties"),
	python: () => import("highlight.js/lib/languages/python"),
	ruby: () => import("highlight.js/lib/languages/ruby"),
	rust: () => import("highlight.js/lib/languages/rust"),
	sql: () => import("highlight.js/lib/languages/sql"),
	typescript: () => import("highlight.js/lib/languages/typescript"),
	xml: () => import("highlight.js/lib/languages/xml"),
	yaml: () => import("highlight.js/lib/languages/yaml"),
} satisfies Record<string, Loader>;

export type HighlightLanguage = keyof typeof LANGUAGES;

const BY_EXTENSION: Record<string, HighlightLanguage> = {
	bash: "bash",
	cfg: "ini",
	cjs: "javascript",
	cnf: "ini",
	conf: "nginx",
	css: "css",
	env: "bash",
	go: "go",
	htm: "xml",
	html: "xml",
	ini: "ini",
	java: "java",
	js: "javascript",
	json: "json",
	lua: "lua",
	md: "markdown",
	mjs: "javascript",
	php: "php",
	properties: "properties",
	py: "python",
	rb: "ruby",
	rs: "rust",
	sh: "bash",
	sql: "sql",
	svg: "xml",
	toml: "ini",
	ts: "typescript",
	xml: "xml",
	yaml: "yaml",
	yml: "yaml",
};

/**
 * The highlighting language for a file, from its extension (or its whole name
 * for `Dockerfile` and dotfiles like `.env`), null when there's none worth
 * highlighting.
 */
export function languageFor(path: string): HighlightLanguage | null {
	const name = (path.split("/").pop() ?? "").toLowerCase();
	if (name === "dockerfile" || name.startsWith("dockerfile.")) {
		return "dockerfile";
	}
	const dot = name.lastIndexOf(".");
	return dot === -1 ? null : (BY_EXTENSION[name.slice(dot + 1)] ?? null);
}

/**
 * Loads highlight.js's core and one language on demand, so neither lands in a
 * page's bundle until a file actually needs them.
 *
 * @returns A function turning source text into escaped, `hljs-*`-classed HTML.
 */
export async function loadHighlighter(
	language: HighlightLanguage,
): Promise<(code: string) => string> {
	const [{ default: hljs }, { default: grammar }] = await Promise.all([
		import("highlight.js/lib/core"),
		LANGUAGES[language](),
	]);
	if (!hljs.getLanguage(language)) {
		hljs.registerLanguage(language, grammar);
	}
	return (code) =>
		hljs.highlight(code, { ignoreIllegals: true, language }).value;
}
