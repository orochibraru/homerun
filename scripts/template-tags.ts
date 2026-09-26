const VERSION_TAG_RE = /^(v?)(\d+(?:\.\d+)*)(.*)$/;
const PRERELEASE_RE =
	/alpha|beta|rc|pre|preview|dev|nightly|edge|canary|snapshot|unstable|test|next|latest/i;

export interface TagShape {
	numbers: number[];
	prefix: string;
	suffix: string;
}

/**
 * Splits a version-like tag into its optional `v` prefix, its dotted numbers
 * and whatever follows them (`18-alpine` is `[18]` + `-alpine`). Returns null
 * for a tag that doesn't start with a number (`latest`, `stable`, `alpine`,
 * `postgresql-latest`), which is a floating tag this tool never touches.
 */
export function parseTag(tag: string): TagShape | null {
	const match = tag.match(VERSION_TAG_RE);
	if (!match) {
		return null;
	}
	const [, prefix = "", digits = "", suffix = ""] = match;
	return { numbers: digits.split(".").map(Number), prefix, suffix };
}

/** Whether a tag is a pinned stable version: version-shaped, and nothing after its numbers marks a pre-release or a floating channel (`-rc1`, `-beta`, `-nightly`, `-latest`). */
export function isStableVersion(tag: string): boolean {
	const shape = parseTag(tag);
	return shape !== null && !PRERELEASE_RE.test(shape.suffix);
}

/** Compares two equal-length version number lists, negative when `a` is older. */
export function compareNumbers(a: number[], b: number[]): number {
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const diff = (a[index] ?? 0) - (b[index] ?? 0);
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
}

/**
 * Whether `candidate` has the same shape as `current`: same prefix, same
 * count of dotted numbers, same suffix, and a leading number at most one digit
 * longer, which keeps a date-stamped `20240101` from passing for a newer `7`.
 */
export function sameShape(current: TagShape, candidate: TagShape): boolean {
	return (
		current.prefix === candidate.prefix &&
		current.suffix === candidate.suffix &&
		current.numbers.length === candidate.numbers.length &&
		String(candidate.numbers[0]).length <= String(current.numbers[0]).length + 1
	);
}

/**
 * The newest stable tag among `candidates` shaped like `current`, or null when
 * `current` isn't pinned or nothing newer exists. `18-alpine` only moves to
 * another `NN-alpine`, `1.2.3` to another full semver, `7` to another bare
 * major; it never moves backwards.
 */
export function newestStableTag(
	current: string,
	candidates: readonly string[],
): string | null {
	const shape = parseTag(current);
	if (!shape || !isStableVersion(current)) {
		return null;
	}
	let best: { numbers: number[]; tag: string } | null = null;
	for (const tag of candidates) {
		const candidate = parseTag(tag);
		if (!candidate || !isStableVersion(tag) || !sameShape(shape, candidate)) {
			continue;
		}
		if (compareNumbers(candidate.numbers, best?.numbers ?? shape.numbers) > 0) {
			best = { numbers: candidate.numbers, tag };
		}
	}
	return best?.tag ?? null;
}

/**
 * Rewrites the `"tag"` field of a template file's source text, leaving every
 * other byte (indentation, key order, trailing newline) untouched.
 *
 * @throws Error when the file doesn't contain exactly one `"tag": "<from>"`.
 */
export function replaceTag(source: string, from: string, to: string): string {
	const needle = `"tag": ${JSON.stringify(from)}`;
	const first = source.indexOf(needle);
	if (first === -1 || source.indexOf(needle, first + 1) !== -1) {
		throw new Error(`Expected exactly one ${needle} in the template file.`);
	}
	return source.replace(needle, `"tag": ${JSON.stringify(to)}`);
}

/**
 * The next page of a registry's tag list from its `Link` response header
 * (`<path?n=100&last=x>; rel="next"`), resolved against `base`, or null on the
 * last page.
 */
export function nextPageUrl(link: string | null, base: string): string | null {
	const match = link?.match(/<([^>]+)>\s*;\s*rel="?next"?/);
	return match?.[1] ? new URL(match[1], base).toString() : null;
}
