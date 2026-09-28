/** Cumulative request counters for one Traefik service, as Traefik reports them. */
export interface TrafficCounters {
	bytesIn: number;
	bytesOut: number;
	durationSeconds: number;
	requests: number;
	status4xx: number;
	status5xx: number;
}

const EMPTY: TrafficCounters = {
	bytesIn: 0,
	bytesOut: 0,
	durationSeconds: 0,
	requests: 0,
	status4xx: 0,
	status5xx: 0,
};

const LINE = /^(traefik_service_[a-z_]+)\{([^}]*)\}\s+(\S+)/;
const LABEL = /(\w+)="((?:[^"\\]|\\.)*)"/g;

/** Adds one metric sample to a service's counters. */
function add(
	counters: TrafficCounters,
	metric: string,
	code: string,
	value: number,
): void {
	if (metric === "traefik_service_requests_total") {
		counters.requests += value;
		if (code.startsWith("4")) {
			counters.status4xx += value;
		} else if (code.startsWith("5")) {
			counters.status5xx += value;
		}
	} else if (metric === "traefik_service_request_duration_seconds_sum") {
		counters.durationSeconds += value;
	} else if (metric === "traefik_service_requests_bytes_total") {
		counters.bytesIn += value;
	} else if (metric === "traefik_service_responses_bytes_total") {
		counters.bytesOut += value;
	}
}

/**
 * Traefik's Prometheus text summed per Traefik service (`web@docker`), over
 * every code, method and protocol. Lines it doesn't use are skipped.
 */
export function parseTraefikMetrics(
	text: string,
): Map<string, TrafficCounters> {
	const byService = new Map<string, TrafficCounters>();
	for (const line of text.split("\n")) {
		const match = LINE.exec(line);
		if (!match) {
			continue;
		}
		const [, metric, rawLabels, rawValue] = match;
		const labels = Object.fromEntries(
			[...(rawLabels ?? "").matchAll(LABEL)].map((m) => [m[1], m[2]]),
		);
		const value = Number(rawValue);
		if (!(labels.service && Number.isFinite(value))) {
			continue;
		}
		const counters = byService.get(labels.service) ?? { ...EMPTY };
		add(counters, metric ?? "", labels.code ?? "", value);
		byService.set(labels.service, counters);
	}
	return byService;
}

/**
 * The Homerun service slug a Traefik service belongs to: the name without
 * its `@provider`, which is the slug itself, or `<slug>-<port>` for a domain
 * routed to another container port. Null for Traefik's own services and
 * anything not deployed by Homerun.
 */
export function slugForTraefikService(
	name: string,
	slugs: Set<string>,
): string | null {
	const bare = name.split("@")[0] ?? "";
	if (slugs.has(bare)) {
		return bare;
	}
	const port = /^(.+)-\d+$/.exec(bare);
	return port?.[1] && slugs.has(port[1]) ? port[1] : null;
}

/** Sums counters per Homerun slug. */
export function countersBySlug(
	byService: Map<string, TrafficCounters>,
	slugs: Set<string>,
): Map<string, TrafficCounters> {
	const bySlug = new Map<string, TrafficCounters>();
	for (const [name, counters] of byService) {
		const slug = slugForTraefikService(name, slugs);
		if (!slug) {
			continue;
		}
		const total = bySlug.get(slug) ?? { ...EMPTY };
		for (const key of Object.keys(total) as (keyof TrafficCounters)[]) {
			total[key] += counters[key];
		}
		bySlug.set(slug, total);
	}
	return bySlug;
}

/**
 * What happened between two reads of the same counters. A counter that went
 * down means Traefik restarted and started over from zero, so the new value
 * is itself the increase.
 */
export function counterDelta(
	previous: TrafficCounters,
	current: TrafficCounters,
): TrafficCounters {
	const reset = current.requests < previous.requests;
	const delta = { ...EMPTY };
	for (const key of Object.keys(delta) as (keyof TrafficCounters)[]) {
		delta[key] = reset
			? current[key]
			: Math.max(0, current[key] - previous[key]);
	}
	return delta;
}
