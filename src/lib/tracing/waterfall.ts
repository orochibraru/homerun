export const STATUS_UNSET = 0;
export const STATUS_OK = 1;
export const STATUS_ERROR = 2;

export const SPAN_KIND_LABELS = [
	"unspecified",
	"internal",
	"server",
	"client",
	"producer",
	"consumer",
] as const;

export interface TraceSummary {
	durationMs: number;
	errorCount: number;
	rootName: string;
	serviceName: string;
	spanCount: number;
	startTime: Date;
	traceId: string;
}

export interface WaterfallInput {
	durationMs: number;
	parentSpanId: string | null;
	spanId: string;
	startTime: Date | string;
}

export interface WaterfallRow<T extends WaterfallInput> {
	depth: number;
	offsetPercent: number;
	span: T;
	widthPercent: number;
}

export interface Waterfall<T extends WaterfallInput> {
	rows: WaterfallRow<T>[];
	startMs: number;
	totalMs: number;
}

function startOf(span: WaterfallInput): number {
	return new Date(span.startTime).getTime();
}

function byStart(a: WaterfallInput, b: WaterfallInput): number {
	return startOf(a) - startOf(b);
}

/**
 * Lays a trace's spans out as a waterfall: depth-first from the roots (spans
 * whose parent isn't in the trace, which also catches a parent that was
 * never received), children in start order, each placed as a percentage of
 * the whole trace's time span.
 */
export function buildWaterfall<T extends WaterfallInput>(
	spans: T[],
): Waterfall<T> {
	if (spans.length === 0) {
		return { rows: [], startMs: 0, totalMs: 0 };
	}
	const startMs = Math.min(...spans.map(startOf));
	const endMs = Math.max(
		...spans.map((span) => startOf(span) + span.durationMs),
	);
	const totalMs = Math.max(endMs - startMs, 0);
	const scale = totalMs > 0 ? totalMs : 1;
	const ids = new Set(spans.map((span) => span.spanId));
	const children = new Map<string, T[]>();
	const roots: T[] = [];
	for (const span of spans) {
		if (span.parentSpanId && ids.has(span.parentSpanId)) {
			const siblings = children.get(span.parentSpanId) ?? [];
			siblings.push(span);
			children.set(span.parentSpanId, siblings);
		} else {
			roots.push(span);
		}
	}
	const rows: WaterfallRow<T>[] = [];
	const seen = new Set<string>();
	const visit = (span: T, depth: number) => {
		if (seen.has(span.spanId)) {
			return;
		}
		seen.add(span.spanId);
		rows.push({
			depth,
			offsetPercent: ((startOf(span) - startMs) / scale) * 100,
			span,
			widthPercent: (span.durationMs / scale) * 100,
		});
		for (const child of (children.get(span.spanId) ?? []).toSorted(byStart)) {
			visit(child, depth + 1);
		}
	};
	for (const root of roots.toSorted(byStart)) {
		visit(root, 0);
	}
	return { rows, startMs, totalMs };
}

/** A span's duration at a useful precision: `850 µs`, `12.4 ms`, `1.24 s`, `2 min 5 s`. */
export function formatSpanDuration(ms: number): string {
	if (ms < 1) {
		return `${Math.round(ms * 1000)} µs`;
	}
	if (ms < 100) {
		return `${Number(ms.toFixed(1))} ms`;
	}
	if (ms < 1000) {
		return `${Math.round(ms)} ms`;
	}
	if (ms < 60_000) {
		return `${(ms / 1000).toFixed(2)} s`;
	}
	const minutes = Math.floor(ms / 60_000);
	return `${minutes} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** The label a span's OTLP status code reads as. */
export function statusLabel(code: number): string {
	if (code === STATUS_ERROR) {
		return "error";
	}
	return code === STATUS_OK ? "ok" : "unset";
}

/** The label a span's OTLP kind reads as. */
export function kindLabel(kind: number): string {
	return SPAN_KIND_LABELS[kind] ?? "unspecified";
}
