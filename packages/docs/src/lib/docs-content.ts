import { marked } from "marked";

/**
 * Sources every guide page straight from the repo root's own `docs/*.md`
 * (the plain-Markdown operator docs `docs/README.md` itself describes as
 * "no generated site yet"), rather than a second, separately-maintained copy
 * of the same content living under `packages/docs/`. `import.meta.glob`'s
 * `query: "?raw"` reads each file's text at build time, so this only ever
 * reflects whatever's checked in, there's no runtime fetch and nothing here
 * can drift from the source file without a rebuild noticing (a renamed doc
 * file 404s instead of silently keeping a stale copy around).
 */
const rawDocs = import.meta.glob("../../../../docs/*.md", {
	eager: true,
	import: "default",
	query: "?raw",
}) as Record<string, string>;

export interface TocEntry {
	id: string;
	text: string;
	depth: 2 | 3;
}

export interface DocPage {
	slug: string;
	title: string;
	html: string;
	toc: TocEntry[];
}

/**
 * Pulls the "On this page" outline straight out of the rendered HTML rather
 * than the markdown tokens, so it can't disagree with the actual heading
 * `id`s `makeRenderer()` below assigns (including its duplicate-id
 * suffixing). h2/h3 only, h1 is the page title and a page's own h4+ is rare
 * and would clutter a short sidebar list.
 */
function extractToc(html: string): TocEntry[] {
	const entries: TocEntry[] = [];
	const headingRe = /<h([23]) id="([^"]+)">(.*?)<\/h\1>/g;
	for (const match of html.matchAll(headingRe)) {
		const depth = Number(match[1]) as 2 | 3;
		const id = match[2] ?? "";
		const text = (match[3] ?? "").replace(/<[^>]+>/g, "");
		entries.push({ depth, id, text });
	}
	return entries;
}

/**
 * Guide reading order, mirrored from `docs/README.md`'s own numbered list :
 * that file is the source of truth for "what order does an operator read
 * these in", this is just carrying the same order into the sidebar nav
 * rather than an alphabetical default that would scramble it.
 */
const ORDER = [
	"getting-started",
	"configuration",
	"services",
	"projects-and-templates",
	"storage-and-backups",
	"remote-hosts-and-agent",
	"users-and-access",
	"api-and-cli",
	"faq-and-limitations",
];

function slugFromPath(path: string): string {
	const filename = path.split("/").pop() ?? path;
	return filename.replace(/\.md$/, "");
}

function titleFromMarkdown(markdown: string, fallback: string): string {
	const heading = markdown.match(/^#\s+(.+)$/m);
	return heading?.[1]?.trim() ?? fallback;
}

// docs/README.md is the guides index, not a guide itself, the landing page's
// own "Read the docs" section covers that role here instead — computed
// before `knownSlugs` below so a link *to* it from another doc still falls
// through to the repo-browser rewrite rather than a broken /docs/README.
const knownSlugs = new Set(
	Object.keys(rawDocs)
		.map(slugFromPath)
		.filter((slug) => slug !== "README"),
);

const REPO_BROWSE_URL =
	"https://git.ombrage.space/orochibraru/homerun/src/branch/main";

/**
 * The source markdown links the way it reads naturally from inside the repo
 * (`../TODO.md`, `services.md#some-heading`, `../compose.prod.yaml`) —
 * correct for GitHub/Gitea's own file browser, but this site doesn't publish
 * every file in the repo, only the guide pages under `docs/`, so a plain
 * relative link would 404 the static build's own prerender crawl (verified
 * live: that's exactly what happened before this rewrite existed). Every
 * link gets rewritten once, at build time: another guide (`slug.md`,
 * optionally with a `#hash`) becomes `/docs/slug`, everything else relative
 * becomes a link to the real file in the repo's own browser instead of a
 * dead local path.
 */
function rewriteRelativeLink(href: string): string {
	if (/^(https?:|mailto:|#)/.test(href)) {
		return href;
	}
	const [pathPart, hash] = href.split("#");
	const bare = (pathPart ?? "").replace(/^\.\.\//, "");
	const slug = bare.replace(/\.md$/, "");
	if (bare.endsWith(".md") && !bare.includes("/") && knownSlugs.has(slug)) {
		return hash ? `/docs/${slug}#${hash}` : `/docs/${slug}`;
	}
	return `${REPO_BROWSE_URL}/${bare}`;
}

/**
 * GitHub's own heading-slug algorithm (lowercase, strip anything that isn't
 * a word char/space/hyphen, then replace *each* space with a hyphen without
 * collapsing runs of them) — matched deliberately, not simplified, because
 * the source markdown's `#anchor` links were hand-written against GitHub/
 * Gitea's actual rendering : "Custom domains & SSL" slugs to
 * `custom-domains--ssl` (the dropped `&` leaves a double space, and two
 * spaces become two hyphens), verified live, collapsing runs of whitespace
 * first (the more "obvious" implementation) produces `custom-domains-ssl`
 * instead and breaks that link.
 */
function slugifyHeading(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/ /g, "-");
}

/**
 * Builds one heading renderer per doc page (a fresh `usedIds` `Set` each
 * time), so `#some-heading` links inside the source markdown — written by
 * hand against GitHub/Gitea's own auto-generated heading ids — resolve to a
 * real element on this site too : marked doesn't add `id`s to headings on
 * its own (unlike GitHub's renderer), verified live, `handleMissingId`
 * caught exactly this the first time a page linked to another page's anchor.
 */
function makeRenderer() {
	const renderer = new marked.Renderer();
	const usedIds = new Set<string>();

	renderer.heading = ({ tokens, depth }) => {
		const text = renderer.parser.parseInline(tokens);
		// Strip whatever inline HTML parsing produced (`<code>`, `<em>`, ...)
		// back down to plain text before slugifying, rather than parsing the
		// tokens twice with a second throwaway renderer. Also decode the HTML
		// entities that same parsing introduces (`&` becomes `&amp;`) : left
		// undecoded, "Custom domains & SSL" slugs to `custom-domains-amp-ssl`
		// instead of GitHub's own `custom-domains--ssl`, verified live — the
		// literal `amp` survives `[^\w\s-]` stripping since it's word chars.
		const plain = text
			.replace(/<[^>]+>/g, "")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'");
		const base = slugifyHeading(plain);
		let id = base;
		let n = 1;
		while (usedIds.has(id)) {
			id = `${base}-${n}`;
			n += 1;
		}
		usedIds.add(id);
		return `<h${depth} id="${id}">${text}</h${depth}>`;
	};

	renderer.link = ({ href, title, tokens }) => {
		const text = renderer.parser.parseInline(tokens);
		const rewritten = rewriteRelativeLink(href);
		const titleAttr = title ? ` title="${title}"` : "";
		const external = /^https?:/.test(rewritten)
			? ' target="_blank" rel="noreferrer"'
			: "";
		return `<a href="${rewritten}"${titleAttr}${external}>${text}</a>`;
	};

	return renderer;
}

const pages: DocPage[] = Object.entries(rawDocs)
	.map(([path, markdown]) => {
		const slug = slugFromPath(path);
		const html = marked.parse(markdown, {
			async: false,
			renderer: makeRenderer(),
		}) as string;
		return {
			html,
			slug,
			title: titleFromMarkdown(markdown, slug),
			toc: extractToc(html),
		};
	})
	.filter((page) => page.slug !== "README");

/** Every guide page, in the reading order `docs/README.md` itself defines — anything not listed there (a future doc page nobody's wired into that order yet) sorts after, alphabetically, rather than silently disappearing from the nav. */
export const docPages: DocPage[] = [...pages].sort((a, b) => {
	const ai = ORDER.indexOf(a.slug);
	const bi = ORDER.indexOf(b.slug);
	if (ai === -1 && bi === -1) {
		return a.slug.localeCompare(b.slug);
	}
	if (ai === -1) {
		return 1;
	}
	if (bi === -1) {
		return -1;
	}
	return ai - bi;
});

export function getDocPage(slug: string): DocPage | undefined {
	return docPages.find((page) => page.slug === slug);
}
