/** The watch or ignore paths an operator typed, one per line, trimmed and without blanks or duplicates. */
export function parseWatchPaths(text: string): string[] {
	return [
		...new Set(
			text
				.split("\n")
				.map((pattern) => pattern.trim())
				.filter(Boolean),
		),
	];
}

/**
 * Whether `file`, a path relative to the repo root, matches the glob
 * `pattern`: from the root (`apps/api/**`), everything under a folder named
 * by its path (`docs`), and at any depth for a pattern without a slash
 * (`*.md`, `Dockerfile`).
 */
export function matchesWatchPath(pattern: string, file: string): boolean {
	const folder = pattern.replace(/\/+$/, "");
	if (
		new Bun.Glob(pattern).match(file) ||
		new Bun.Glob(`${folder}/**`).match(file)
	) {
		return true;
	}
	return (
		!folder.includes("/") &&
		new Bun.Glob(folder).match(file.slice(file.lastIndexOf("/") + 1))
	);
}

/**
 * Whether a push that changed `files` deploys a service with these watch and
 * ignore paths: at least one file has to match a watch path (every file does
 * when there are none) and no ignore path. `files` null, a push whose payload
 * didn't list them, always deploys.
 */
export function pushMatchesWatchPaths(
	files: string[] | null,
	paths: { ignore: string[]; watch: string[] },
): boolean {
	if (!files || (paths.watch.length === 0 && paths.ignore.length === 0)) {
		return true;
	}
	return files.some(
		(file) =>
			(paths.watch.length === 0 ||
				paths.watch.some((pattern) => matchesWatchPath(pattern, file))) &&
			!paths.ignore.some((pattern) => matchesWatchPath(pattern, file)),
	);
}
