/**
 * Pure parsing for pasted `.env`-file content, used by every env-var form
 * (service Env Vars tab, services/new, templates/new) to turn a pasted block
 * of text into rows for the existing key/value editor. No Docker/DB
 * dependency, stays a plain exported function per the "pure transform
 * doesn't need an instance" convention.
 */
export interface ParsedEnvVar {
	key: string;
	value: string;
}

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Strips one layer of matching single/double quotes, if present. */
function unquote(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return value.slice(1, -1);
		}
	}
	return value;
}

/**
 * Parses `.env`-style text (`KEY=value` per line, optional `export ` prefix,
 * optional quotes, `#`-comments, blank lines all skipped). Lines that don't
 * look like `KEY=value` (no `=`, or a key that isn't a valid env var name)
 * are silently skipped rather than throwing, since pasted text may include
 * stray comments or malformed lines.
 */
export function parseDotEnv(text: string): ParsedEnvVar[] {
	const rows: ParsedEnvVar[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) {
			continue;
		}

		const withoutExport = line.startsWith("export ")
			? line.slice("export ".length).trim()
			: line;

		const eq = withoutExport.indexOf("=");
		if (eq === -1) {
			continue;
		}

		const key = withoutExport.slice(0, eq).trim();
		if (!KEY_PATTERN.test(key)) {
			continue;
		}

		const rawValue = withoutExport.slice(eq + 1).trim();
		rows.push({ key, value: unquote(rawValue) });
	}
	return rows;
}

/**
 * Merges parsed `.env` rows into an existing key/value row list: an imported
 * key overwrites the existing row with that key (in place, preserving its
 * position), a new key is appended. A single leftover blank row (the
 * "always at least one row" placeholder every env-var form seeds itself
 * with) is dropped once real rows exist.
 */
export function mergeEnvRows<T extends ParsedEnvVar>(
	existing: T[],
	imported: ParsedEnvVar[],
	makeRow: (row: ParsedEnvVar) => T,
): T[] {
	const rows = existing.filter((row) => row.key !== "" || row.value !== "");
	for (const imp of imported) {
		const target = rows.find((row) => row.key === imp.key);
		if (target) {
			target.value = imp.value;
		} else {
			rows.push(makeRow(imp));
		}
	}
	return rows.length > 0 ? rows : [makeRow({ key: "", value: "" })];
}
