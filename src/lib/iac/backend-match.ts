import { slugify } from "#lib/slug.js";

/** Whether `inner` is a run of whole words of `outer`, at least three letters long. */
function containsWords(outer: string, inner: string): boolean {
	return inner.length > 2 && `-${outer}-`.includes(`-${inner}-`);
}

/** How closely two slugs match: 3 when equal, 2 when one is a run of the other's words, 1 when they share a word of three letters or more, 0 otherwise. */
function closeness(first: string, second: string): number {
	if (first === second) {
		return 3;
	}
	if (containsWords(first, second) || containsWords(second, first)) {
		return 2;
	}
	const words = new Set(first.split("-"));
	return second.split("-").some((word) => word.length > 2 && words.has(word))
		? 1
		: 0;
}

/**
 * The state project whose name best matches `name` (a stack's or a
 * service's), compared as slugs so case, spacing and punctuation don't
 * matter; a tie goes to the shorter name, the closer one. Null when nothing
 * is close.
 */
export function matchBackend(
	name: string,
	projects: { id: string; name: string }[],
): string | null {
	const target = slugify(name);
	if (!target) {
		return null;
	}
	let best: { id: string; length: number; score: number } | null = null;
	for (const project of projects) {
		const slug = slugify(project.name);
		const score = slug ? closeness(target, slug) : 0;
		if (
			score > 0 &&
			(!best ||
				score > best.score ||
				(score === best.score && slug.length < best.length))
		) {
			best = { id: project.id, length: slug.length, score };
		}
	}
	return best?.id ?? null;
}
