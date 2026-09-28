import { matchesTagPattern } from "./release-channels";

/** The branch patterns an operator typed, one per line or comma separated, trimmed and without duplicates. */
export function parseBranchPatterns(text: string): string[] {
	return [
		...new Set(
			text
				.split(/[\n,]/)
				.map((pattern) => pattern.trim())
				.filter(Boolean),
		),
	];
}

/** Why a branch pattern can't be used, null when it can. */
export function branchPatternProblem(pattern: string): string | null {
	if (pattern.length > 200) {
		return `"${pattern.slice(0, 40)}…" is longer than 200 characters.`;
	}
	if (/\s/.test(pattern)) {
		return `"${pattern}" contains whitespace, which no branch name can.`;
	}
	return null;
}

/**
 * Whether a pull request from `branch` gets a preview: it has to match one
 * of `include` when there are any, and none of `exclude`. Exclusions win.
 * A pull request with no known branch only passes when neither list is set.
 */
export function previewBranchAllowed(
	branch: string | null,
	include: string[],
	exclude: string[],
): boolean {
	if (!branch) {
		return include.length === 0 && exclude.length === 0;
	}
	if (exclude.some((pattern) => matchesTagPattern(pattern, branch))) {
		return false;
	}
	return (
		include.length === 0 ||
		include.some((pattern) => matchesTagPattern(pattern, branch))
	);
}
