const MAX_SLUG_LENGTH = 63;

/**
 * Builds the `attempt`-th fallback for a taken slug by appending `-<attempt>`,
 * truncating `base` first so the result stays within 63 characters and never
 * contains a doubled or leading hyphen.
 */
export function suffixedSlug(base: string, attempt: number): string {
	const suffix = `-${attempt}`;
	const head = base
		.slice(0, MAX_SLUG_LENGTH - suffix.length)
		.replace(/-+$/, "");
	return head ? `${head}${suffix}` : String(attempt);
}

/**
 * Returns `base` if it's free, otherwise the first of `base-2`, `base-3`, …
 * (see `suffixedSlug`) that `isTaken` reports as free.
 */
export async function uniqueSlug(
	base: string,
	isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
	let candidate = base;
	let attempt = 2;
	// oxlint-disable-next-line no-await-in-loop -- each candidate can only be checked once the previous one came back taken
	while (await isTaken(candidate)) {
		candidate = suffixedSlug(base, attempt);
		attempt += 1;
	}
	return candidate;
}
