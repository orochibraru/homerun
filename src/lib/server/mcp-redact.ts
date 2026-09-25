export const REDACTED = "[redacted]";

const ENV_MAP_KEYS = new Set(["envVars", "vars"]);

/**
 * A copy of an API body safe to hand an agent: every env var value is
 * replaced with `REDACTED` (names kept) and every encrypted `…Enc` field is
 * dropped, however deep they sit.
 */
export function redactSecrets(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redactSecrets);
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	const out: Record<string, unknown> = {};
	for (const [key, inner] of Object.entries(value)) {
		if (key.endsWith("Enc")) {
			continue;
		}
		out[key] =
			ENV_MAP_KEYS.has(key) && inner && typeof inner === "object"
				? Object.fromEntries(Object.keys(inner).map((name) => [name, REDACTED]))
				: redactSecrets(inner);
	}
	return out;
}

/** A body's text with its secrets redacted when it's JSON, unchanged otherwise. */
export function redactText(text: string): string {
	try {
		return JSON.stringify(redactSecrets(JSON.parse(text)));
	} catch {
		return text;
	}
}

/**
 * Env vars an agent sent back for `update_service`, with every value it only
 * saw as `REDACTED` restored to the one stored, so echoing a redacted map
 * doesn't overwrite real secrets with the placeholder.
 */
export function restoreRedacted(
	sent: Record<string, unknown>,
	stored: Record<string, string>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(sent).map(([name, value]) => [
			name,
			value === REDACTED ? (stored[name] ?? value) : value,
		]),
	);
}
