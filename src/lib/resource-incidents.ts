import {
	describeReading,
	RESOURCE_LABELS,
	type ResourceKind,
	type ResourceReading,
} from "./resource-thresholds";

export const DEFAULT_SUSTAIN_SECONDS = 60;
export const DEFAULT_REMINDER_MINUTES = 30;

export type IncidentLevel = "hard" | "soft";

export interface ResourceIncidentState {
	id: string | null;
	kind: ResourceKind;
	lastNotifiedAt: number;
	level: IncidentLevel;
	peak: number;
	startedAt: number;
}

export type IncidentEventType = "open" | "escalate" | "remind" | "recover";

export interface IncidentEvent {
	incident: ResourceIncidentState;
	reading: ResourceReading;
	type: IncidentEventType;
}

export interface IncidentTiming {
	reminderMs: number;
	sustainMs: number;
}

/**
 * Turns successive host readings into resource incidents, the way baba
 * does: a resource past its soft or hard limit opens an incident only once
 * it's stayed there for `sustainMs` (a disk opens at once, it doesn't spike),
 * escalates when it crosses from soft to hard, reminds every `reminderMs`
 * while it stays open (never when 0), and recovers on the first reading
 * back under its soft limit. One incident per resource at most. A resource
 * a reading leaves out (no GPU, an unreadable disk) keeps its state.
 */
export class ResourceIncidentTracker {
	readonly #breachSince = new Map<ResourceKind, number>();
	readonly #open = new Map<ResourceKind, ResourceIncidentState>();

	/** Picks up the incidents still open from before a restart, so they neither alert again nor lose their recovery. */
	restore(incidents: ResourceIncidentState[]): void {
		for (const incident of incidents) {
			this.#open.set(incident.kind, { ...incident });
		}
	}

	/** The open incidents, as they stand. */
	open(): ResourceIncidentState[] {
		return [...this.#open.values()];
	}

	/** What `readings` taken at `now` call for, in the order to act on them. */
	next(
		readings: ResourceReading[],
		now: number,
		timing: IncidentTiming,
	): IncidentEvent[] {
		const events: IncidentEvent[] = [];
		for (const reading of readings) {
			const open = this.#open.get(reading.kind);
			if (reading.level === "ok") {
				this.#breachSince.delete(reading.kind);
				if (open) {
					this.#open.delete(reading.kind);
					events.push({ incident: open, reading, type: "recover" });
				}
				continue;
			}
			if (open) {
				open.peak = Math.max(open.peak, reading.percent);
				if (reading.level === "hard" && open.level === "soft") {
					open.level = "hard";
					open.lastNotifiedAt = now;
					events.push({ incident: open, reading, type: "escalate" });
				} else if (
					timing.reminderMs > 0 &&
					now - open.lastNotifiedAt >= timing.reminderMs
				) {
					open.lastNotifiedAt = now;
					events.push({ incident: open, reading, type: "remind" });
				}
				continue;
			}
			const since = this.#breachSince.get(reading.kind) ?? now;
			this.#breachSince.set(reading.kind, since);
			if (reading.kind === "disk" || now - since >= timing.sustainMs) {
				this.#breachSince.delete(reading.kind);
				const incident: ResourceIncidentState = {
					id: null,
					kind: reading.kind,
					lastNotifiedAt: now,
					level: reading.level,
					peak: reading.percent,
					startedAt: since,
				};
				this.#open.set(reading.kind, incident);
				events.push({ incident, reading, type: "open" });
			}
		}
		return events;
	}
}

/** A duration in plain words: `45s`, `12 min`, `3 h 5 min`. */
export function formatDuration(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) {
		return `${Math.max(0, Math.round(ms / 1000))}s`;
	}
	if (minutes < 60) {
		return `${minutes} min`;
	}
	const rest = minutes % 60;
	return rest
		? `${Math.floor(minutes / 60)} h ${rest} min`
		: `${Math.floor(minutes / 60)} h`;
}

/** One line about an incident event for its resource, as the alert shows it. */
export function describeIncidentEvent(
	event: IncidentEvent,
	now: number,
): string {
	const { incident, reading } = event;
	const label = RESOURCE_LABELS[reading.kind];
	const lasted = formatDuration(now - incident.startedAt);
	switch (event.type) {
		case "recover":
			return `${label} back to ${reading.percent}% after ${lasted} (peak ${incident.peak}%)`;
		case "remind":
			return `${label} still at ${reading.percent}% for ${lasted} (peak ${incident.peak}%)`;
		default:
			return reading.kind === "disk"
				? describeReading(reading)
				: `${describeReading(reading)} for ${lasted}`;
	}
}

/**
 * Reads the alert timing from the Resource limits form: `sustainSeconds`, how
 * long a limit has to stay crossed before it alerts (0 to 3600, 0 alerting on
 * the first reading), and `reminderMinutes` between reminders (0 to 1440, 0
 * for none). Returns what's wrong instead when either isn't a whole number in
 * range.
 */
export function parseAlertTiming(
	get: (name: string) => string | null,
): { reminderMinutes: number; sustainSeconds: number } | string {
	const sustainSeconds = Number(get("sustainSeconds"));
	const reminderMinutes = Number(get("reminderMinutes"));
	if (
		!Number.isInteger(sustainSeconds) ||
		sustainSeconds < 0 ||
		sustainSeconds > 3600
	) {
		return "Alert after has to be a whole number of seconds from 0 to 3600.";
	}
	if (
		!Number.isInteger(reminderMinutes) ||
		reminderMinutes < 0 ||
		reminderMinutes > 1440
	) {
		return "Remind every has to be a whole number of minutes from 0 to 1440.";
	}
	return { reminderMinutes, sustainSeconds };
}
