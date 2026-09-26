import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { Glob } from "bun";
import { parseImageRef, parseWwwAuthenticate } from "../src/lib/registry-ref";
import {
	isStableVersion,
	newestStableTag,
	nextPageUrl,
	replaceTag,
} from "./template-tags";

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 30_000;

interface Row {
	from: string;
	image: string;
	note: string;
	slug: string;
	to: string | null;
}

/**
 * Fetches a registry URL, answering a Bearer challenge with an anonymous token
 * once and reusing it for later pages.
 *
 * @throws Error on any non-2xx answer after authenticating.
 */
async function registryFetch(
	url: string,
	auth: { token: string | null },
): Promise<Response> {
	const request = () =>
		fetch(url, {
			headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	let response = await request();
	if (response.status === 401) {
		const challenge = parseWwwAuthenticate(
			response.headers.get("www-authenticate") ?? "",
		);
		if (!challenge) {
			throw new Error(`${url} answered 401 without a Bearer challenge.`);
		}
		const tokenUrl = new URL(challenge.realm);
		if (challenge.service) {
			tokenUrl.searchParams.set("service", challenge.service);
		}
		if (challenge.scope) {
			tokenUrl.searchParams.set("scope", challenge.scope);
		}
		const tokenResponse = await fetch(tokenUrl, {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!tokenResponse.ok) {
			throw new Error(
				`Token request to ${tokenUrl.host} answered ${tokenResponse.status}.`,
			);
		}
		const body = (await tokenResponse.json()) as {
			access_token?: string;
			token?: string;
		};
		auth.token = body.token ?? body.access_token ?? null;
		response = await request();
	}
	if (!response.ok) {
		throw new Error(`${url} answered ${response.status}.`);
	}
	return response;
}

/**
 * Lists every tag of an image through the registry's v2 `tags/list`
 * endpoint, following `Link` pagination.
 *
 * @throws Error when the registry refuses or the list never ends.
 */
async function listTags(image: string): Promise<string[]> {
	const { host, repo } = parseImageRef(image);
	const auth = { token: null as string | null };
	const tags: string[] = [];
	let url: string | null =
		`https://${host}/v2/${repo}/tags/list?n=${PAGE_SIZE}`;
	for (let page = 0; url && page < MAX_PAGES; page++) {
		// oxlint-disable-next-line no-await-in-loop -- each page's URL comes from the previous page's Link header
		const response = await registryFetch(url, auth);
		const body = (await response.json()) as { tags?: string[] | null };
		tags.push(...(body.tags ?? []));
		url = nextPageUrl(response.headers.get("link"), response.url);
	}
	if (url) {
		throw new Error(`${image} has more than ${MAX_PAGES} pages of tags.`);
	}
	return tags;
}

/** Resolves one template file's newest tag and, unless `dryRun`, writes it back. */
async function bumpFile(path: string, dryRun: boolean): Promise<Row> {
	const source = await readFile(path, "utf8");
	const { image, tag } = JSON.parse(source) as { image: string; tag: string };
	const slug =
		path
			.split("/")
			.pop()
			?.replace(/\.json$/, "") ?? path;
	const row: Row = { from: tag, image, note: "", slug, to: null };
	if (!isStableVersion(tag)) {
		row.note = "floating tag, left alone";
		return row;
	}
	try {
		row.to = newestStableTag(tag, await listTags(image));
	} catch (error) {
		row.note = `registry error: ${error instanceof Error ? error.message : String(error)}`;
		return row;
	}
	if (!row.to) {
		row.note = "already the newest";
		return row;
	}
	if (!dryRun) {
		await writeFile(path, replaceTag(source, tag, row.to));
	}
	return row;
}

/** Renders the run as the Markdown the bump PR's body carries. */
function summarize(rows: Row[], dryRun: boolean): string {
	const bumped = rows.filter((row) => row.to);
	const failed = rows.filter((row) => row.note.startsWith("registry error"));
	const pinned = rows.filter((row) => row.note !== "floating tag, left alone");
	const lines = [
		`Checked ${pinned.length} pinned templates of ${rows.length}; ${bumped.length} ${dryRun ? "would be bumped" : "bumped"}, ${failed.length} registry errors.`,
		"",
		"| Template | Image | From | To |",
		"| --- | --- | --- | --- |",
		...pinned.map(
			(row) =>
				`| ${row.slug} | \`${row.image}\` | \`${row.from}\` | ${row.to ? `\`${row.to}\`` : row.note} |`,
		),
		"",
		`Floating tags left alone: ${rows
			.filter((row) => !pinned.includes(row))
			.map((row) => `${row.slug} (\`${row.from}\`)`)
			.join(", ")}.`,
	];
	return lines.join("\n");
}

const dryRun = process.argv.includes("--dry-run");
const paths = (
	await Array.fromAsync(new Glob("templates/*/*.json").scan("."))
).sort();
const rows = await Promise.all(paths.map((path) => bumpFile(path, dryRun)));
console.log(summarize(rows, dryRun));
