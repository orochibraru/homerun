import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { Logger } from "$lib/logger";

const logger = new Logger("GitHubRepo");

export interface GitHubRepoInfo {
	description: string | null;
	latestReleasePublishedAt: string | null;
	latestReleaseTag: string | null;
	pushedAt: string | null;
	readmeHtml: string | null;
	stars: number | null;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "homerun-app";

const globalForGithub = globalThis as unknown as {
	__github_repo_cache?: Map<
		string,
		{ data: GitHubRepoInfo | null; fetchedAt: number }
	>;
};

function getCache() {
	if (!globalForGithub.__github_repo_cache) {
		globalForGithub.__github_repo_cache = new Map();
	}
	return globalForGithub.__github_repo_cache;
}

function parseGitHubRepo(
	sourceUrl: string,
): { owner: string; repo: string } | null {
	let url: URL;
	try {
		url = new URL(sourceUrl);
	} catch {
		return null;
	}
	if (url.hostname !== "github.com") {
		return null;
	}
	const [owner, repoRaw] = url.pathname.split("/").filter(Boolean);
	if (!(owner && repoRaw)) {
		return null;
	}
	return { owner, repo: repoRaw.replace(/\.git$/, "") };
}

function githubFetch(url: string): Promise<Response> {
	return fetch(url, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": USER_AGENT,
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
}

async function fetchReadme(
	owner: string,
	repo: string,
): Promise<string | null> {
	const res = await githubFetch(
		`https://api.github.com/repos/${owner}/${repo}/readme`,
	);
	if (!res.ok) {
		return null;
	}
	const json = (await res.json()) as { content: string; encoding: string };
	return json.encoding === "base64"
		? Buffer.from(json.content, "base64").toString("utf-8")
		: json.content;
}

function renderReadme(
	markdown: string,
	owner: string,
	repo: string,
	branch: string,
): string {
	const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`;
	const blobBase = `https://github.com/${owner}/${repo}/blob/${branch}/`;

	const resolveRelative = (href: string, base: string): string =>
		/^(https?:|mailto:|#|data:)/.test(href)
			? href
			: `${base}${href.replace(/^\.?\//, "")}`;

	const renderer = new marked.Renderer();
	renderer.image = ({ href, title, text }) => {
		const src = resolveRelative(href, rawBase);
		const titleAttr = title ? ` title="${title}"` : "";
		return `<img src="${src}" alt="${text}"${titleAttr}>`;
	};
	renderer.link = ({ href, title, tokens }) => {
		const url = resolveRelative(href, blobBase);
		const text = renderer.parser.parseInline(tokens);
		const titleAttr = title ? ` title="${title}"` : "";
		return `<a href="${url}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
	};

	const html = marked.parse(markdown, { async: false, renderer }) as string;

	return sanitizeHtml(html, {
		allowedAttributes: {
			"*": ["align"],
			a: ["href", "title", "target", "rel"],
			code: ["class"],
			img: ["src", "alt", "title", "width", "height"],
			th: ["colspan", "rowspan"],
			td: ["colspan", "rowspan"],
		},
		allowedTags: [
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"p",
			"a",
			"img",
			"br",
			"hr",
			"ul",
			"ol",
			"li",
			"blockquote",
			"pre",
			"code",
			"strong",
			"em",
			"del",
			"b",
			"i",
			"table",
			"thead",
			"tbody",
			"tr",
			"th",
			"td",
			"div",
			"span",
			"details",
			"summary",
		],
		allowedSchemes: ["http", "https", "mailto"],
	});
}

async function fetchRepoInfo(
	owner: string,
	repo: string,
): Promise<GitHubRepoInfo | null> {
	const repoRes = await githubFetch(
		`https://api.github.com/repos/${owner}/${repo}`,
	);
	if (!repoRes.ok) {
		logger.warn(
			`Repo lookup failed: ${owner}/${repo} status=${repoRes.status}`,
		);
		return null;
	}
	const repoJson = (await repoRes.json()) as {
		default_branch: string;
		description: string | null;
		pushed_at: string | null;
		stargazers_count: number;
	};

	const [releaseRes, readmeMarkdown] = await Promise.all([
		githubFetch(
			`https://api.github.com/repos/${owner}/${repo}/releases/latest`,
		),
		fetchReadme(owner, repo),
	]);

	let latestReleaseTag: string | null = null;
	let latestReleasePublishedAt: string | null = null;
	if (releaseRes.ok) {
		const release = (await releaseRes.json()) as {
			published_at: string | null;
			tag_name: string;
		};
		latestReleaseTag = release.tag_name;
		latestReleasePublishedAt = release.published_at;
	}

	const readmeHtml = readmeMarkdown
		? renderReadme(readmeMarkdown, owner, repo, repoJson.default_branch)
		: null;

	return {
		description: repoJson.description,
		latestReleasePublishedAt,
		latestReleaseTag,
		pushedAt: repoJson.pushed_at,
		readmeHtml,
		stars: repoJson.stargazers_count,
	};
}

export async function getGitHubRepoInfo(
	sourceUrl: string | null,
): Promise<GitHubRepoInfo | null> {
	if (!sourceUrl) {
		return null;
	}
	const parsed = parseGitHubRepo(sourceUrl);
	if (!parsed) {
		return null;
	}
	const key = `${parsed.owner}/${parsed.repo}`;
	const cached = getCache().get(key);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return cached.data;
	}

	try {
		const data = await fetchRepoInfo(parsed.owner, parsed.repo);
		getCache().set(key, { data, fetchedAt: Date.now() });
		return data;
	} catch (err) {
		logger.warn(
			`Fetch failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
		);
		getCache().set(key, { data: null, fetchedAt: Date.now() });
		return null;
	}
}
