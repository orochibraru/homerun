import type { ContainerStatus } from "#lib/types.js";

/** How many buckets a lane is cut into. */
export const LANE_BUCKETS = 48;

/** How far back a lane reaches. */
export const LANE_SPAN_MS = 24 * 3_600_000;

/** One service's last 24 hours: requests and errors per bucket, its average response time, and where it was deployed. */
export interface Lane {
	avgResponseMs: number | null;
	deploys: { failed: boolean; index: number }[];
	errors: number[];
	requests: number[];
}

/** The bucket width, in seconds, a lane's buckets are counted in. */
export const LANE_BUCKET_SECONDS = LANE_SPAN_MS / LANE_BUCKETS / 1000;

/** Where a lane starts: the bucket boundary `LANE_BUCKETS - 1` buckets before the one `now` falls in. */
export function laneStart(now: Date): Date {
	const width = LANE_BUCKET_SECONDS * 1000;
	const current = Math.floor(now.getTime() / width);
	return new Date((current - LANE_BUCKETS + 1) * width);
}

/**
 * Builds a lane from per-bucket traffic (each `bucket` being epoch seconds
 * divided by `LANE_BUCKET_SECONDS`) and deployments, dropping anything
 * outside the 24 hours that end at `now`.
 */
export function buildLane(
	points: {
		bucket: number;
		durationMs?: number;
		errors: number;
		requests: number;
	}[],
	deploys: { createdAt: Date; status: ContainerStatus }[],
	now: Date,
): Lane {
	const first = Math.floor(
		laneStart(now).getTime() / 1000 / LANE_BUCKET_SECONDS,
	);
	const requests = Array.from({ length: LANE_BUCKETS }, () => 0);
	const errors = Array.from({ length: LANE_BUCKETS }, () => 0);
	let durationMs = 0;
	let total = 0;
	for (const point of points) {
		const index = point.bucket - first;
		if (index >= 0 && index < LANE_BUCKETS) {
			requests[index] += point.requests;
			errors[index] += point.errors;
			durationMs += point.durationMs ?? 0;
			total += point.requests;
		}
	}
	return {
		avgResponseMs: total ? durationMs / total : null,
		deploys: deploys.flatMap((dep) => {
			const index =
				Math.floor(dep.createdAt.getTime() / 1000 / LANE_BUCKET_SECONDS) -
				first;
			return index >= 0 && index < LANE_BUCKETS
				? [{ failed: dep.status === "failed", index }]
				: [];
		}),
		errors,
		requests,
	};
}

/** The hue token a stack's lanes are drawn in, cycling through the four lane colours by the stack's position. */
export function laneHue(position: number): string {
	return `var(--lane-${((position % 4) + 4) % 4})`;
}

/**
 * Each stack's lane hue: top-level stacks take the four lane colours in the
 * order given, and a substack shares its top-level ancestor's.
 */
export function stackHues(
	stacks: { id: string; parentId: string | null }[],
): Map<string, string> {
	const parents = new Map(stacks.map((stack) => [stack.id, stack.parentId]));
	const roots = stacks
		.filter((stack) => !stack.parentId || !parents.has(stack.parentId))
		.map((stack) => stack.id);
	const rootOf = (id: string): string => {
		const seen = new Set<string>();
		let current = id;
		let parent = parents.get(current);
		while (parent && parents.has(parent) && !seen.has(parent)) {
			seen.add(current);
			current = parent;
			parent = parents.get(current);
		}
		return current;
	};
	return new Map(
		stacks.map((stack) => [stack.id, laneHue(roots.indexOf(rootOf(stack.id)))]),
	);
}
