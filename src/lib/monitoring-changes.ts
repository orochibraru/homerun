import { type Change, formatChange } from "./metrics-format";
import type { MonitoringSummary } from "./services/monitoring.service";

export type MonitoringMetric =
	| "avgCpu"
	| "avgMemory"
	| "avgResponse"
	| "bandwidth"
	| "errorRate"
	| "requests"
	| "uptimeNetwork"
	| "uptimePublic";

type Totals = Pick<MonitoringSummary, "availability" | "resources" | "traffic">;

/** A percentage of `part` over `whole`, null when there's nothing to divide by. */
function share(part: number, whole: number): number | null {
	return whole ? (part / whole) * 100 : null;
}

/** Each metric's value in one period, the way the cards compare them. */
function values(totals: Totals): Record<MonitoringMetric, number | null> {
	const { availability, resources, traffic } = totals;
	return {
		avgCpu: resources.avgCpuPercent,
		avgMemory: resources.avgMemUsedMb,
		avgResponse: traffic.avgResponseMs,
		bandwidth: traffic.bytesOut,
		errorRate: share(traffic.status4xx + traffic.status5xx, traffic.requests),
		requests: traffic.requests,
		uptimeNetwork: share(
			availability.internal.ok,
			availability.internal.checks,
		),
		uptimePublic: share(availability.external.ok, availability.external.checks),
	};
}

/** Whether a metric going up is good news, null when it's neither (more traffic). */
const HIGHER_IS_BETTER: Record<MonitoringMetric, boolean | null> = {
	avgCpu: false,
	avgMemory: false,
	avgResponse: false,
	bandwidth: null,
	errorRate: false,
	requests: null,
	uptimeNetwork: true,
	uptimePublic: true,
};

/** Rates that are already percentages move in points rather than by a relative share. */
const IN_POINTS = new Set<MonitoringMetric>([
	"errorRate",
	"uptimeNetwork",
	"uptimePublic",
]);

/**
 * How each metric of a range moved against the previous period of the same
 * length, empty when the range has none (all time).
 */
export function monitoringChanges(
	summary: MonitoringSummary,
): Partial<Record<MonitoringMetric, Change | null>> {
	if (!summary.previous) {
		return {};
	}
	const now = values(summary);
	const before = values(summary.previous);
	return Object.fromEntries(
		(Object.keys(now) as MonitoringMetric[]).map((metric) => [
			metric,
			formatChange(now[metric], before[metric], {
				higherIsBetter: HIGHER_IS_BETTER[metric],
				points: IN_POINTS.has(metric),
			}),
		]),
	);
}
