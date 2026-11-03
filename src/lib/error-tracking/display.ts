import type {
	StoredBreadcrumb,
	StoredFrame,
} from "#lib/error-tracking/event.js";

const BUILD_PREFIXES = [
	/^file:\/\//,
	/^(?:\.\.?\/)+/,
	/^.*?\/?\.svelte-kit\/output\/(?:server|client)\//,
	/^.*?\/node_modules\//,
	/^\/app\//,
];

/** A file path with the build output noise (`../`, `.svelte-kit/output/server/`, `node_modules/`, `file://`) stripped. */
export function stripBuildPath(path: string): string {
	let out = path;
	for (const prefix of BUILD_PREFIXES) {
		out = out.replace(prefix, "");
	}
	return out;
}

/** An issue's culprit (`function (path)`) with the path inside the parentheses stripped of build output noise. */
export function cleanCulprit(culprit: string): string {
	return culprit.replace(
		/\(([^)]+)\)$/,
		(_, path: string) => `(${stripBuildPath(path)})`,
	);
}

export interface FramePath {
	base: string;
	dir: string;
	full: string;
	line: string;
}

/**
 * Splits a frame's file into the folder and the file name, with the build
 * output noise every bundled SvelteKit or Node frame carries (`../`,
 * `.svelte-kit/output/server/`, `node_modules/`, `file://`) stripped from the
 * folder, and its `:line:col` kept apart.
 */
export function framePath(frame: StoredFrame): FramePath {
	const full = frame.filename ?? frame.absPath ?? frame.module ?? "?";
	const path = stripBuildPath(full);
	const slash = path.lastIndexOf("/");
	return {
		base: slash === -1 ? path : path.slice(slash + 1),
		dir: slash === -1 ? "" : path.slice(0, slash + 1),
		full,
		line: frame.lineno
			? `:${frame.lineno}${frame.colno ? `:${frame.colno}` : ""}`
			: "",
	};
}

/**
 * A breadcrumb's message as a person reads it: an HTTP crumb's JSON data
 * becomes `POST url → 200`, any other JSON object `key=value` pairs, plain
 * text stays as it is.
 */
export function breadcrumbText(crumb: StoredBreadcrumb): string {
	const message = crumb.message ?? "";
	if (!message.startsWith("{")) {
		return message;
	}
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(message) as Record<string, unknown>;
	} catch {
		return message;
	}
	const method = data["http.request.method"] ?? data.method;
	if (typeof data.url === "string") {
		const status = data.status_code ? ` → ${String(data.status_code)}` : "";
		return `${typeof method === "string" ? `${method} ` : ""}${data.url}${status}`;
	}
	return Object.entries(data)
		.map(
			([key, value]) =>
				`${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
		)
		.join("  ");
}

/** A release or commit id short enough to scan: the first 7 characters of a long hex hash, anything else as it is. */
export function shortRelease(release: string | null): string {
	if (!release) {
		return "-";
	}
	return /^[0-9a-f]{12,}$/i.test(release) ? release.slice(0, 7) : release;
}

/** Splits text into plain runs and http(s) URLs, so a message's links can be rendered clickable. */
export function linkify(text: string): { href: string | null; text: string }[] {
	const parts: { href: string | null; text: string }[] = [];
	let last = 0;
	for (const match of text.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
		const start = match.index ?? 0;
		if (start > last) {
			parts.push({ href: null, text: text.slice(last, start) });
		}
		parts.push({ href: match[0], text: match[0] });
		last = start + match[0].length;
	}
	if (last < text.length) {
		parts.push({ href: null, text: text.slice(last) });
	}
	return parts;
}
