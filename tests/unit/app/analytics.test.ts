import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const {
	bucketSecondsFor,
	isAnalyticsRange,
	isTimeZone,
	rangeStart,
	startOfDay,
} = await import("../../../src/lib/analytics-ranges");
const {
	counterDelta,
	countersBySlug,
	parseTraefikMetrics,
	slugForTraefikService,
} = await import("../../../src/lib/traffic-metrics");
const { AnalyticsService, padBuckets } = await import(
	"../../../src/lib/services/analytics.service"
);
const { StatsSampler } = await import(
	"../../../src/lib/services/stats/stats-sampler"
);
const { StatSampleDTO } = await import("../../../src/lib/dto/stat-sample-dto");
const { TrafficSampleDTO } = await import(
	"../../../src/lib/dto/traffic-sample-dto"
);
const { UptimeCheckDTO } = await import(
	"../../../src/lib/dto/uptime-check-dto"
);
const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");
const { DockerService } = await import(
	"../../../src/lib/services/docker.service"
);
const { SystemStatsService } = await import(
	"../../../src/lib/services/system-stats.service"
);
const { CapacityService } = await import(
	"../../../src/lib/services/capacity.service"
);
const { Logger } = await import("../../../src/lib/logger");

const METRICS = `# HELP traefik_service_requests_total How many HTTP requests processed.
traefik_service_requests_total{code="200",method="GET",protocol="http",service="web@docker"} 90
traefik_service_requests_total{code="404",method="GET",protocol="http",service="web@docker"} 6
traefik_service_requests_total{code="502",method="GET",protocol="http",service="web-8080@docker"} 4
traefik_service_requests_total{code="200",method="GET",protocol="http",service="dashboard@internal"} 3
traefik_service_request_duration_seconds_sum{code="200",method="GET",protocol="http",service="web@docker"} 4.5
traefik_service_request_duration_seconds_count{code="200",method="GET",protocol="http",service="web@docker"} 90
traefik_service_requests_bytes_total{code="200",method="GET",protocol="http",service="web@docker"} 1000
traefik_service_responses_bytes_total{code="200",method="GET",protocol="http",service="web@docker"} 50000
traefik_entrypoint_requests_total{code="200",entrypoint="websecure",method="GET",protocol="http"} 99
traefik_service_requests_total{code="200",service="broken@docker"} NaN
`;

describe("traffic metrics", () => {
	test("sums Traefik's service metrics per Homerun slug", () => {
		const bySlug = countersBySlug(
			parseTraefikMetrics(METRICS),
			new Set(["web", "api"]),
		);
		expect([...bySlug.keys()]).toEqual(["web"]);
		expect(bySlug.get("web")).toEqual({
			bytesIn: 1000,
			bytesOut: 50_000,
			durationSeconds: 4.5,
			requests: 100,
			status4xx: 6,
			status5xx: 4,
		});
	});

	test("maps a Traefik service name back to a slug", () => {
		const slugs = new Set(["web", "web-api"]);
		expect(slugForTraefikService("web@swarm", slugs)).toBe("web");
		expect(slugForTraefikService("web-api@docker", slugs)).toBe("web-api");
		expect(slugForTraefikService("web-3000@docker", slugs)).toBe("web");
		expect(slugForTraefikService("api@internal", slugs)).toBeNull();
		expect(slugForTraefikService("other-80@docker", slugs)).toBeNull();
	});

	test("a delta is the increase, and a restart counts from zero", () => {
		const before = {
			bytesIn: 10,
			bytesOut: 100,
			durationSeconds: 1,
			requests: 10,
			status4xx: 1,
			status5xx: 0,
		};
		expect(
			counterDelta(before, { ...before, durationSeconds: 3, requests: 15 }),
		).toEqual({
			bytesIn: 0,
			bytesOut: 0,
			durationSeconds: 2,
			requests: 5,
			status4xx: 0,
			status5xx: 0,
		});
		expect(counterDelta(before, { ...before, requests: 2 }).requests).toBe(2);
	});
});

describe("analytics ranges", () => {
	const now = new Date("2026-09-28T22:30:00Z");

	test("today starts at local midnight, DST included", () => {
		expect(startOfDay(now, "Europe/Paris").toISOString()).toBe(
			"2026-09-28T22:00:00.000Z",
		);
		expect(startOfDay(now, "America/New_York").toISOString()).toBe(
			"2026-09-28T04:00:00.000Z",
		);
		expect(
			startOfDay(
				new Date("2026-03-29T12:00:00Z"),
				"Europe/Paris",
			).toISOString(),
		).toBe("2026-03-28T23:00:00.000Z");
	});

	test("fixed windows, all time and bucket widths", () => {
		expect(rangeStart("all", now, "UTC")).toBeNull();
		expect(rangeStart("today", now, "UTC")?.toISOString()).toBe(
			"2026-09-28T00:00:00.000Z",
		);
		expect(rangeStart("week", now, "UTC")?.toISOString()).toBe(
			"2026-09-21T22:30:00.000Z",
		);
		expect(bucketSecondsFor(0)).toBe(300);
		expect(bucketSecondsFor(86_400_000)).toBe(1800);
		expect(bucketSecondsFor(365 * 86_400_000) % 300).toBe(0);
		expect(isAnalyticsRange("month")).toBe(true);
		expect(isAnalyticsRange("decade")).toBe(false);
		expect(isTimeZone("Europe/Paris")).toBe(true);
		expect(isTimeZone("Mars/Olympus")).toBe(false);
	});
});

describe("padBuckets", () => {
	test("fills every bucket of the span, keeping recorded ones", () => {
		const at = (minute: number) => new Date(minute * 60_000);
		const padded = padBuckets(
			[{ at: at(10), value: 3 }],
			{ bucketSeconds: 300, end: at(20), start: at(0) },
			(when) => ({ at: when, value: 0 }),
		);
		expect(padded.map((point) => point.value)).toEqual([0, 0, 3, 0, 0]);
		expect(padded[1]?.at).toEqual(at(5));
	});
});

describe("AnalyticsService", () => {
	afterEach(() => restoreStubs());

	test("all time starts at the oldest record and asks every source", async () => {
		const seen: unknown[] = [];
		stub(TrafficSampleDTO, "firstAt", async () => new Date("2026-09-01"));
		stub(StatSampleDTO, "firstAt", async () => new Date("2026-08-01"));
		stub(TrafficSampleDTO, "totals", async (_id: string, since: unknown) => {
			seen.push(since);
			return { requests: 3 };
		});
		stub(
			TrafficSampleDTO,
			"series",
			async (_: string, __: unknown, bucket: number) => {
				seen.push(bucket);
				return [];
			},
		);
		stub(StatSampleDTO, "totals", async () => ({ avgCpuPercent: 1 }));
		stub(StatSampleDTO, "series", async () => []);
		stub(UptimeCheckDTO, "availability", async () => ({}));
		const result = await AnalyticsService.forService(
			"s1",
			"all",
			"UTC",
			new Date("2026-09-28"),
		);
		expect(result.since).toBeNull();
		expect(seen[0]).toBeNull();
		expect(result.bucketSeconds).toBe(bucketSecondsFor(58 * 86_400_000));
		expect(result.traffic).toEqual({ requests: 3 } as never);
	});

	test("a service with nothing recorded still gets a range", async () => {
		stub(TrafficSampleDTO, "firstAt", async () => null);
		stub(StatSampleDTO, "firstAt", async () => null);
		for (const [target, key] of [
			[TrafficSampleDTO, "totals"],
			[TrafficSampleDTO, "series"],
			[StatSampleDTO, "totals"],
			[StatSampleDTO, "series"],
			[UptimeCheckDTO, "availability"],
		] as const) {
			stub(target, key, async () => []);
		}
		expect(
			(await AnalyticsService.forService("s1", "all", "UTC")).bucketSeconds,
		).toBe(300);
	});
});

describe("StatsSampler traffic", () => {
	let traffic: unknown[][] = [];
	let metrics: string | null = METRICS;

	beforeEach(() => {
		traffic = [];
		metrics = METRICS;
		stub(Logger.prototype, "warn", () => undefined);
		stub(SystemStatsService, "getSystemStats", async () => ({
			cpuPercent: 5,
			diskUsedGb: 1,
			memTotalMb: 1000,
			memUsedMb: 500,
		}));
		stub(CapacityService, "evaluate", async () => {
			throw new Error("thresholds down");
		});
		stub(ServiceDTO, "listRunningWithContainers", async () => [
			{ containerId: "c1", id: "id-web", slug: "web", swarmServiceId: null },
			{ containerId: null, id: "id-api", slug: "api", swarmServiceId: "sw1" },
			{ containerId: null, id: "id-off", slug: "off", swarmServiceId: null },
		]);
		stub(DockerService, "sampleContainerStats", async () => ({
			cpuPercent: 1,
			memLimitMb: 100,
			memUsedMb: 10,
			netRxBytes: 1,
			netTxBytes: 2,
		}));
		stub(DockerService, "listSwarmReplicas", async () => []);
		stub(DockerService, "traefikMetrics", async () => metrics);
		stub(StatSampleDTO, "recordMany", async () => undefined);
		stub(StatSampleDTO, "prune", async () => undefined);
		stub(TrafficSampleDTO, "prune", async () => undefined);
		stub(TrafficSampleDTO, "recordMany", async (rows: unknown[]) => {
			traffic.push(rows);
		});
	});

	afterEach(() => restoreStubs());

	test("the first read is a baseline, the next records the increase", async () => {
		const sampler = new StatsSampler() as unknown as {
			tick: () => Promise<void>;
		};
		await sampler.tick();
		expect(traffic).toEqual([]);
		metrics = METRICS.replace("} 90\n", "} 120\n");
		await sampler.tick();
		expect(traffic).toEqual([
			[
				{
					bytesIn: 0,
					bytesOut: 0,
					durationSeconds: 0,
					requests: 30,
					serviceId: "id-web",
					status4xx: 0,
					status5xx: 0,
				},
			],
		]);
		metrics = null;
		await sampler.tick();
		expect(traffic).toHaveLength(1);
	});

	test("prunes both histories every sixtieth tick", async () => {
		let pruned = 0;
		stub(TrafficSampleDTO, "prune", async () => {
			pruned += 1;
		});
		const sampler = new StatsSampler() as unknown as {
			tick: () => Promise<void>;
		};
		for (let i = 0; i < 60; i += 1) {
			// oxlint-disable-next-line no-await-in-loop -- ticks run one after another
			await sampler.tick();
		}
		expect(pruned).toBe(1);
	});
});
