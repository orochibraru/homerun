import {
	originalPositionFor,
	sourceContentFor,
	TraceMap,
} from "@jridgewell/trace-mapping";
import {
	culpritFrame,
	frameLabel,
	mainException,
	type StoredErrorEvent,
	type StoredFrame,
} from "./event";

const CONTEXT_LINES = 5;

/** The path a map describes, from its upload path: `./_app/x.js.map` becomes `_app/x.js`. */
export function mappedFileName(uploadPath: string): string {
	return uploadPath
		.replace(/\\/g, "/")
		.replace(/^(\.\/|\/)+/, "")
		.replace(/\.map$/, "");
}

/** Whether a frame points at a file served over HTTP, which is what a source map can resolve. */
export function isMinifiedFrame(frame: StoredFrame): boolean {
	return /^https?:\/\//.test(frame.absPath ?? "") && frame.lineno !== null;
}

/**
 * Which uploaded map covers the file at `url`: the longest map name its path
 * ends with, so `https://app.example.com/_app/immutable/app.js` matches
 * `_app/immutable/app.js` over a bare `app.js`. Null when none does.
 */
export function matchMapName(url: string, names: string[]): string | null {
	if (!URL.canParse(url)) {
		return null;
	}
	const path = new URL(url).pathname.replace(/^\/+/, "");
	let best: string | null = null;
	for (const name of names) {
		if (
			(path === name || path.endsWith(`/${name}`)) &&
			name.length > (best?.length ?? 0)
		) {
			best = name;
		}
	}
	return best;
}

/** Parses an uploaded map, throwing when it isn't a version 3 source map. */
export function parseSourceMap(content: string): TraceMap {
	const parsed: unknown = JSON.parse(content);
	if (
		!parsed ||
		typeof parsed !== "object" ||
		(parsed as { version?: unknown }).version !== 3
	) {
		throw new Error("not a version 3 source map");
	}
	return new TraceMap(parsed as ConstructorParameters<typeof TraceMap>[0]);
}

/** A source's path as a repository path: bundler scheme and `../` prefixes stripped. */
function cleanSource(source: string): string {
	return source
		.replace(/^webpack:\/\/[^/]*\//, "")
		.replace(/^(\.\.\/|\.\/)+/, "");
}

/**
 * `frame` mapped back through `map` to its original source: file, line,
 * column, the original function name when the map has one, and up to five
 * lines of context either side from the map's embedded sources. A frame
 * the map has no position for comes back unchanged. Frames inside
 * `node_modules` aren't in-app.
 */
export function resolveFrame(frame: StoredFrame, map: TraceMap): StoredFrame {
	if (frame.lineno === null) {
		return frame;
	}
	const position = originalPositionFor(map, {
		column: Math.max(0, (frame.colno ?? 1) - 1),
		line: frame.lineno,
	});
	if (position.source === null || position.line === null) {
		return frame;
	}
	const source = cleanSource(position.source);
	const lines = sourceContentFor(map, position.source)?.split("\n") ?? null;
	const index = position.line - 1;
	return {
		...frame,
		absPath: source,
		colno: position.column + 1,
		contextLine: lines?.[index] ?? null,
		filename: source,
		function: position.name ?? frame.function,
		inApp: !source.includes("node_modules/"),
		lineno: position.line,
		postContext: lines?.slice(index + 1, index + 1 + CONTEXT_LINES) ?? [],
		preContext: lines?.slice(Math.max(0, index - CONTEXT_LINES), index) ?? [],
	};
}

/**
 * `event` with every minified frame whose file has a map in `maps` (keyed by
 * map name) resolved to its source, and the culprit recomputed from the
 * resolved frames. Frames without a map stay as sent.
 */
export function applySourceMaps(
	event: StoredErrorEvent,
	maps: Map<string, TraceMap>,
): StoredErrorEvent {
	const names = [...maps.keys()];
	const exceptions = event.exceptions.map((exception) => ({
		...exception,
		frames: exception.frames.map((frame) => {
			const name = isMinifiedFrame(frame)
				? matchMapName(frame.absPath ?? "", names)
				: null;
			const map = name ? maps.get(name) : undefined;
			return map ? resolveFrame(frame, map) : frame;
		}),
	}));
	const resolved = { ...event, exceptions };
	const main = mainException(resolved);
	const culprit = main ? culpritFrame(main.frames) : null;
	return {
		...resolved,
		culprit: (culprit ? frameLabel(culprit) : null) ?? event.culprit,
	};
}
