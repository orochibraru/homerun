export const DEFAULT_TRACE_RETENTION_DAYS = 7;

export interface TracingColumns {
	otelCollectorEnabled?: boolean;
	traceRetentionDays?: number;
}

export const MIN_TRACE_RETENTION_DAYS = 1;

export const MAX_TRACE_RETENTION_DAYS = 90;

/** The settings row's tracing columns with their defaults filled in. */
export function tracingSettings(row: {
	otelCollectorEnabled: boolean | null;
	traceRetentionDays: number | null;
}): { collectorEnabled: boolean; retentionDays: number } {
	return {
		collectorEnabled: row.otelCollectorEnabled === true,
		retentionDays: row.traceRetentionDays ?? DEFAULT_TRACE_RETENTION_DAYS,
	};
}

/** A retention typed into the settings form as whole days within range, or null when it isn't one. */
export function parseRetentionDays(raw: unknown): number | null {
	const text = typeof raw === "string" ? raw.trim() : "";
	if (!/^\d+$/.test(text)) {
		return null;
	}
	const days = Number(text);
	return days >= MIN_TRACE_RETENTION_DAYS && days <= MAX_TRACE_RETENTION_DAYS
		? days
		: null;
}

/** The oldest span start a retention of `days` keeps at `now`. */
export function retentionCutoff(days: number, now: Date): Date {
	return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
