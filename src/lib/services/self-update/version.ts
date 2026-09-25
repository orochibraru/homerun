const BUILD_RE = /^[A-Za-z]+\.(\d+)$/;
const VERSION_RE =
	/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
	prerelease: string | null;
}

/** Parses a semver-ish version string (optional leading `v`, optional prerelease, build metadata ignored), or null if it doesn't match. */
export function parseVersion(input: string): ParsedVersion | null {
	const match = VERSION_RE.exec(input.trim());
	if (!match) {
		return null;
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] ?? null,
	};
}

/** Reformats a version string to bare `major.minor.patch[-prerelease]`, stripping any `v` prefix and build metadata, or null if it doesn't parse. */
export function normalizeVersion(input: string): string | null {
	const parsed = parseVersion(input);
	if (!parsed) {
		return null;
	}
	const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
	return parsed.prerelease ? `${core}-${parsed.prerelease}` : core;
}

function comparePrerelease(a: string | null, b: string | null): number {
	if (a === b) {
		return 0;
	}
	if (a === null) {
		return 1;
	}
	if (b === null) {
		return -1;
	}
	const buildA = BUILD_RE.exec(a)?.[1];
	const buildB = BUILD_RE.exec(b)?.[1];
	if (buildA && buildB) {
		return Number(buildA) - Number(buildB);
	}
	return a.localeCompare(b, "en", { numeric: true });
}

/**
 * Compares two version strings by major/minor/patch then prerelease
 * (a release beats any of its prereleases; two prereleases compare
 * lexically/numerically, except two main builds like `canary.N` and
 * `nightly.N`, which compare by run number alone). Returns -1/0/1, or null if either fails to parse.
 */
export function compareVersions(a: string, b: string): number | null {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!(left && right)) {
		return null;
	}
	const diff =
		left.major - right.major ||
		left.minor - right.minor ||
		left.patch - right.patch;
	if (diff !== 0) {
		return Math.sign(diff);
	}
	return Math.sign(comparePrerelease(left.prerelease, right.prerelease));
}

/** Whether `candidate` is a strictly newer version than `current`; false (not an error) if either fails to parse. */
export function isNewerVersion(candidate: string, current: string): boolean {
	return (compareVersions(candidate, current) ?? 0) > 0;
}
