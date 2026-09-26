import { createHash } from "node:crypto";
import type { StoredErrorEvent, StoredFrame } from "./event";

const DEFAULT_MARKERS = new Set(["{{ default }}", "{{default}}"]);
const UUID_RE =
	/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;
const HEX_RE = /\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/gi;
const NUMBER_RE = /\d+(\.\d+)?/g;
const QUERY_RE = /[?#].*$/;
const LINE_SUFFIX_RE = /:\d+(:\d+)?$/;

/** Replaces the parts of a message that change between occurrences of one error (ids, addresses, numbers) with placeholders. */
export function normalizeMessage(message: string): string {
	return message
		.replace(UUID_RE, "<uuid>")
		.replace(HEX_RE, "<hex>")
		.replace(NUMBER_RE, "<n>")
		.trim()
		.slice(0, 500);
}

function frameKey(frame: StoredFrame): string {
	const where = (frame.module ?? frame.filename ?? frame.absPath ?? "")
		.replace(QUERY_RE, "")
		.replace(LINE_SUFFIX_RE, "")
		.replace(UUID_RE, "<uuid>")
		.replace(HEX_RE, "<hex>");
	const name = (frame.function ?? "?")
		.replace(HEX_RE, "<hex>")
		.replace(NUMBER_RE, "<n>");
	return `${where}:${name}`;
}

/**
 * The components the default grouping hashes: per exception in the chain, its
 * type and its in-app frames (every frame when none is in-app) by module or
 * file and function, never line numbers, so an unrelated edit higher up the
 * file doesn't split an issue. An exception without frames groups by type and
 * normalized value; an event without exceptions by its normalized message.
 */
export function defaultGroupingComponents(event: StoredErrorEvent): string[] {
	const components: string[] = [];
	for (const exception of event.exceptions) {
		const inApp = exception.frames.filter((frame) => frame.inApp);
		const frames = inApp.length > 0 ? inApp : exception.frames;
		components.push(`type:${exception.type ?? ""}`);
		if (frames.length > 0) {
			components.push(...frames.map(frameKey));
		} else {
			components.push(`value:${normalizeMessage(exception.value ?? "")}`);
		}
	}
	if (components.length === 0) {
		components.push(
			`message:${normalizeMessage(event.message ?? event.title)}`,
		);
	}
	return components;
}

/**
 * The grouping hash of an event: its SDK-sent `fingerprint` when there is one
 * (`{{ default }}` expanding to the default components), otherwise the default
 * components. Events with the same hash in one service are one issue.
 */
export function groupingHash(event: StoredErrorEvent): string {
	const components = event.fingerprint
		? event.fingerprint.flatMap((part) =>
				DEFAULT_MARKERS.has(part)
					? defaultGroupingComponents(event)
					: [`custom:${part}`],
			)
		: defaultGroupingComponents(event);
	return createHash("sha256")
		.update(components.join("\n"))
		.digest("hex")
		.slice(0, 32);
}
