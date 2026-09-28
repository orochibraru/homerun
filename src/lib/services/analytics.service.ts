import {
	type AnalyticsRange,
	bucketSecondsFor,
	rangeStart,
} from "$lib/analytics-ranges";
import {
	type ResourcePoint,
	type ResourceTotals,
	StatSampleDTO,
} from "$lib/dto/stat-sample-dto";
import {
	type TrafficPoint,
	TrafficSampleDTO,
	type TrafficTotals,
} from "$lib/dto/traffic-sample-dto";
import { type Availability, UptimeCheckDTO } from "$lib/dto/uptime-check-dto";

/** A resource chart bucket, null where nothing was sampled. */
type ResourceSlot = {
	[K in keyof ResourcePoint]: K extends "at" ? Date : number | null;
};

/** Everything a service's Analytics view shows for one range. */
export interface ServiceAnalytics {
	availability: { external: Availability; internal: Availability };
	bucketSeconds: number;
	spanSeconds: number;
	range: AnalyticsRange;
	resources: ResourceTotals;
	resourceSeries: ResourceSlot[];
	since: Date | null;
	traffic: TrafficTotals;
	trafficSeries: TrafficPoint[];
}

/**
 * `points` with an empty point for every bucket from `start` to `end` that
 * has none, so a chart spans its whole range instead of only the buckets
 * something was recorded in.
 */
export function padBuckets<T extends { at: Date }>(
	points: T[],
	span: { bucketSeconds: number; end: Date; start: Date },
	empty: (at: Date) => T,
): T[] {
	const { bucketSeconds, end, start } = span;
	const width = bucketSeconds * 1000;
	const byBucket = new Map(
		points.map((point) => [Math.floor(point.at.getTime() / width), point]),
	);
	const padded: T[] = [];
	for (
		let bucket = Math.floor(start.getTime() / width);
		bucket <= Math.floor(end.getTime() / width);
		bucket += 1
	) {
		padded.push(byBucket.get(bucket) ?? empty(new Date(bucket * width)));
	}
	return padded;
}

/**
 * A service's recorded history summed up like a website's analytics: the
 * requests it served and how fast (from Traefik's metrics), its availability
 * (the uptime probes) and its CPU and memory (the resource samples), over a
 * range picked from today to all time.
 */
class AnalyticsServiceClass {
	/**
	 * One range of a service's analytics. `zone` is the viewer's time zone,
	 * which decides where "today" starts.
	 */
	async forService(
		serviceId: string,
		range: AnalyticsRange,
		zone: string,
		now = new Date(),
	): Promise<ServiceAnalytics> {
		const since = rangeStart(range, now, zone);
		const start = since ?? (await this.#firstRecord(serviceId)) ?? now;
		const bucketSeconds = bucketSecondsFor(now.getTime() - start.getTime());
		const [traffic, trafficSeries, resources, resourceSeries, availability] =
			await Promise.all([
				TrafficSampleDTO.totals(serviceId, since),
				TrafficSampleDTO.series(serviceId, since, bucketSeconds),
				StatSampleDTO.totals(serviceId, since),
				StatSampleDTO.series(serviceId, since, bucketSeconds),
				UptimeCheckDTO.availability(serviceId, since),
			]);
		return {
			availability,
			bucketSeconds,
			range,
			resourceSeries: padBuckets<ResourceSlot>(
				resourceSeries,
				{ bucketSeconds, end: now, start },
				(at) => ({ at, cpuPercent: null, memUsedMb: null }),
			),
			resources,
			since,
			spanSeconds: Math.max(1, (now.getTime() - start.getTime()) / 1000),
			traffic,
			trafficSeries: padBuckets(
				trafficSeries,
				{ bucketSeconds, end: now, start },
				(at) => ({ at, avgResponseMs: null, errors: 0, requests: 0 }),
			),
		};
	}

	/** The oldest thing recorded about a service, where "all time" starts. */
	async #firstRecord(serviceId: string): Promise<Date | null> {
		const dates = (
			await Promise.all([
				TrafficSampleDTO.firstAt(serviceId),
				StatSampleDTO.firstAt(serviceId),
			])
		).filter((date): date is Date => date !== null);
		return dates.length
			? new Date(Math.min(...dates.map((date) => date.getTime())))
			: null;
	}
}

export const AnalyticsService = new AnalyticsServiceClass();
