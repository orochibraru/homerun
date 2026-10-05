import { createHighlighter, type Highlighter } from "shiki";

export type ShikiLanguage = "hcl" | "shellscript" | "text" | "typescript";

const LANGUAGES = ["hcl", "shellscript", "typescript"];
const THEMES = { dark: "github-dark", light: "github-light" } as const;

let highlighter: Promise<Highlighter> | null = null;

/**
 * Highlights `code` with Shiki, light and dark colours both carried as CSS
 * variables (`--shiki-light`/`--shiki-dark`) so the page's theme picks one.
 * The highlighter is created once per process, on first use.
 *
 * @returns Escaped HTML, a `<pre class="shiki">` element.
 */
export async function highlightCode(
	code: string,
	language: ShikiLanguage,
): Promise<string> {
	highlighter ??= createHighlighter({
		langs: LANGUAGES,
		themes: Object.values(THEMES),
	});
	return (await highlighter).codeToHtml(code, {
		defaultColor: false,
		lang: language,
		themes: THEMES,
	});
}
