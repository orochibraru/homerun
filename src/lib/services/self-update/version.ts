const VERSION_RE =
	/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
	prerelease: string | null;
}

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
	return a.localeCompare(b, "en", { numeric: true });
}

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

export function isNewerVersion(candidate: string, current: string): boolean {
	return (compareVersions(candidate, current) ?? 0) > 0;
}
