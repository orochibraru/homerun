import {
	type ResourcePoint,
	type ResourceScope,
	type ResourceTotals,
	StatSampleDTO,
} from "$lib/dto/stat-sample-dto";
import {
	type TrafficPoint,
	TrafficSampleDTO,
	type TrafficTotals,
} from "$lib/dto/traffic-sample-dto";
import { type Availability, UptimeCheckDTO } from "$lib/dto/uptime-check-dto";
import {
	bucketSecondsFor,
	type MonitoringRange,
	rangeStart,
} from "$lib/monitoring-ranges";

/** A resource chart bucket, null where nothing was sampled. */
type ResourceSlot = {
	[K in keyof ResourcePoint]: K extends "at" ? Date : number | null;
};

/** Everything a service's Monitoring view shows for one range. */
export interface MonitoringSummary {
	availability: { external: Availability; internal: Availability };
	bucketSeconds: number;
	spanSeconds: number;
	range: MonitoringRange;
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

/** What an monitoring view covers: the services whose traffic and uptime count, and whose CPU and memory. */
export interface MonitoringScope {
	resources: ResourceScope;
	serviceIds: string[];
}

/** One service's row in a stack's or the instance's breakdown. */
export interface ServiceBreakdown extends TrafficTotals {
	avgCpuPercent: number | null;
	avgMemUsedMb: number | null;
	serviceId: string;
}

/**
 * Recorded history summed up for monitoring: the requests served
 * and how fast (from Traefik's metrics), availability (the uptime probes) and
 * CPU and memory (the resource samples), over a range picked from today to
 * all time, for one service, a stack with its substacks, or the instance.
 */
class MonitoringServiceClass {
	/**
	 * One range of a service's monitoring. `zone` is the viewer's time zone,
	 * which decides where "today" starts.
	 */
	async forService(
		serviceId: string,
		range: MonitoringRange,
		zone: string,
		now = new Date(),
	): Promise<MonitoringSummary> {
		return await this.forScope(
			{ resources: { serviceIds: [serviceId] }, serviceIds: [serviceId] },
			range,
			zone,
			now,
		);
	}

	/** One range of a scope's monitoring: traffic and uptime summed over its services, resources over its resource scope. */
	async forScope(
		scope: MonitoringScope,
		range: MonitoringRange,
		zone: string,
		now = new Date(),
	): Promise<MonitoringSummary> {
		const since = rangeStart(range, now, zone);
		const start = since ?? (await this.#firstRecord(scope)) ?? now;
		const bucketSeconds = bucketSecondsFor(now.getTime() - start.getTime());
		const [traffic, trafficSeries, resources, resourceSeries, availability] =
			await Promise.all([
				TrafficSampleDTO.totals(scope.serviceIds, since),
				TrafficSampleDTO.series(scope.serviceIds, since, bucketSeconds),
				StatSampleDTO.totals(scope.resources, since),
				StatSampleDTO.series(scope.resources, since, bucketSeconds),
				UptimeCheckDTO.availability(scope.serviceIds, since),
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

	/** Each service's traffic and average resources from `since` on, busiest first. */
	async breakdown(
		serviceIds: string[],
		since: Date | null,
	): Promise<ServiceBreakdown[]> {
		const [traffic, resources] = await Promise.all([
			TrafficSampleDTO.totalsByService(serviceIds, since),
			StatSampleDTO.averagesByService(serviceIds, since),
		]);
		return serviceIds
			.map((serviceId) => ({
				...(traffic.get(serviceId) ?? {
					avgResponseMs: null,
					bytesIn: 0,
					bytesOut: 0,
					requests: 0,
					status4xx: 0,
					status5xx: 0,
				}),
				avgCpuPercent: resources.get(serviceId)?.avgCpuPercent ?? null,
				avgMemUsedMb: resources.get(serviceId)?.avgMemUsedMb ?? null,
				serviceId,
			}))
			.toSorted(
				(a, b) =>
					b.requests - a.requests ||
					(b.avgCpuPercent ?? 0) - (a.avgCpuPercent ?? 0),
			);
	}

	/** The oldest thing recorded in a scope, where "all time" starts. */
	async #firstRecord(scope: MonitoringScope): Promise<Date | null> {
		const dates = (
			await Promise.all([
				TrafficSampleDTO.firstAt(scope.serviceIds),
				StatSampleDTO.firstAt(scope.resources),
			])
		).filter((date): date is Date => date !== null);
		return dates.length
			? new Date(Math.min(...dates.map((date) => date.getTime())))
			: null;
	}
}

export const MonitoringService = new MonitoringServiceClass();
