import {
	type DeployTrigger,
	deployTriggerLabel,
	isRollback,
} from "#lib/deploy-trigger.js";
import {
	SERVICE_EVENT_LANE_LABELS,
	SERVICE_EVENT_LANES,
	type ServiceEventLane,
} from "#lib/service-events.js";
import type { ContainerStatus } from "#lib/types.js";

/** One marker's worth of activity: something that happened to a service, when, and who did it. */
export interface ActivityEvent {
	actor: string | null;
	at: number;
	detail: string[];
	failed: boolean;
	lane: ServiceEventLane;
	summary: string;
}

/** Events close enough on the time axis to share one marker, at their average position (0 to 1). */
export interface ActivityCluster {
	events: ActivityEvent[];
	failed: boolean;
	position: number;
}

/** One horizontal lane of the Activity card. */
export interface ActivityLane {
	clusters: ActivityCluster[];
	id: ServiceEventLane;
	label: string;
}

/** The period the card spans, in epoch milliseconds. */
export interface ActivityWindow {
	from: number;
	to: number;
}

const IN_FLIGHT: ReadonlySet<ContainerStatus> = new Set([
	"pending",
	"pulling",
	"starting",
]);

/** A deployment as a Deploys lane event: queued or in progress, succeeded, failed or rolled back, by whoever (or whatever) started it. */
export function deploymentEvent(row: {
	actorName: string | null;
	createdAt: Date | number | string;
	errorMessage: string | null;
	gitCommit: string | null;
	imageRef: string | null;
	rollbackOfDeploymentId: string | null;
	status: ContainerStatus;
	trigger: DeployTrigger | null;
}): ActivityEvent {
	const rollback = isRollback(row.rollbackOfDeploymentId, row.trigger);
	const failed = row.status === "failed";
	const noun = rollback ? "Rollback" : "Deploy";
	const summary = failed
		? `${noun} failed`
		: IN_FLIGHT.has(row.status)
			? `${noun} in progress`
			: rollback
				? "Rolled back"
				: "Deployed";
	const detail = [
		row.imageRef,
		row.gitCommit ? `Commit ${row.gitCommit.slice(0, 7)}` : null,
		failed && row.errorMessage ? row.errorMessage.slice(0, 120) : null,
	].filter((line): line is string => Boolean(line));
	const automatic =
		row.trigger && row.trigger !== "manual"
			? deployTriggerLabel(row.trigger)
			: null;
	return {
		actor: row.actorName ?? automatic,
		at: new Date(row.createdAt).getTime(),
		detail,
		failed,
		lane: "deploys",
		summary,
	};
}

/**
 * Sorts `events` into one lane per category, every lane present even when
 * empty, and merges events that land within `gap` (a share of the window's
 * width) of the cluster they follow into one marker. Events outside the
 * window are dropped.
 */
export function activityLanes(
	events: ActivityEvent[],
	window: ActivityWindow,
	gap = 0.015,
): ActivityLane[] {
	const span = Math.max(window.to - window.from, 1);
	const sorted = events
		.filter((event) => event.at >= window.from && event.at <= window.to)
		.toSorted((a, b) => a.at - b.at);
	return SERVICE_EVENT_LANES.map((id) => {
		const clusters: { events: ActivityEvent[]; positions: number[] }[] = [];
		for (const event of sorted) {
			if (event.lane !== id) {
				continue;
			}
			const position = (event.at - window.from) / span;
			const last = clusters.at(-1);
			if (last && position - last.positions[0] <= gap) {
				last.events.push(event);
				last.positions.push(position);
			} else {
				clusters.push({ events: [event], positions: [position] });
			}
		}
		return {
			clusters: clusters.map((cluster) => ({
				events: cluster.events,
				failed: cluster.events.some((event) => event.failed),
				position:
					cluster.positions.reduce((sum, value) => sum + value, 0) /
					cluster.positions.length,
			})),
			id,
			label: SERVICE_EVENT_LANE_LABELS[id],
		};
	});
}

/** `count` evenly spaced moments across the window, first at its start and last at its end, for the time axis. */
export function activityTicks(window: ActivityWindow, count = 7): number[] {
	if (count < 2) {
		return [window.to];
	}
	return Array.from(
		{ length: count },
		(_, index) =>
			window.from + ((window.to - window.from) * index) / (count - 1),
	);
}
