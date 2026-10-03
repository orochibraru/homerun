import { config } from "#lib/config.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { NotificationDTO } from "#lib/dto/notification-dto.js";
import { ResourceIncidentDTO } from "#lib/dto/resource-incident-dto.js";
import { Logger } from "#lib/logger.js";
import {
	describeIncidentEvent,
	type IncidentEvent,
	ResourceIncidentTracker,
} from "#lib/resource-incidents.js";
import {
	describeReading,
	type HostUsageInput,
	RESOURCE_LABELS,
	type ResourceReading,
	readResources,
} from "#lib/resource-thresholds.js";
import { NotificationChannelService } from "./notification-channel.service.ts";
import type { ChannelMessage } from "./notification-messages.ts";
import { SystemStatsService } from "./system-stats.service.ts";

const logger = new Logger("Capacity");

const FRESH_MS = 3 * 60 * 1000;

/** Thrown when a new service is refused because the server is past a hard threshold. */
export class CapacityError extends Error {}

export type ResourceAlertEvent =
	| "resource.critical"
	| "resource.recovered"
	| "resource.warning";

export interface ResourceAlert {
	event: ResourceAlertEvent;
	events: IncidentEvent[];
	reminder: boolean;
}

/**
 * Groups one check's incident events into the alerts to send: resources that
 * just opened or escalated past their hard limit (critical) or their soft one
 * (warning), reminders for each level, then the ones back to normal.
 */
export function groupIncidentEvents(events: IncidentEvent[]): ResourceAlert[] {
	const groups: ResourceAlert[] = [
		{ event: "resource.critical", events: [], reminder: false },
		{ event: "resource.warning", events: [], reminder: false },
		{ event: "resource.critical", events: [], reminder: true },
		{ event: "resource.warning", events: [], reminder: true },
		{ event: "resource.recovered", events: [], reminder: false },
	];
	for (const event of events) {
		const hard = event.incident.level === "hard";
		const index =
			event.type === "recover"
				? 4
				: (event.type === "remind" ? 2 : 0) + (hard ? 0 : 1);
		groups[index]?.events.push(event);
	}
	return groups.filter((group) => group.events.length > 0);
}

const TITLES: Record<ResourceAlertEvent, [string, string]> = {
	"resource.critical": [
		"Server past a hard resource limit",
		"Server still past a hard resource limit",
	],
	"resource.recovered": [
		"Server resources back to normal",
		"Server resources back to normal",
	],
	"resource.warning": [
		"Server resources running high",
		"Server resources still running high",
	],
};

/** The channel message for a resource alert: a server-wide one, with no service attached. */
export function resourceAlertMessage(
	alert: ResourceAlert,
	origin: string | null,
	timestamp: string,
	now: number = Date.parse(timestamp),
): ChannelMessage {
	return {
		detail:
			alert.event === "resource.critical"
				? "New services are refused until usage drops back under the hard limit."
				: null,
		event: alert.event,
		fields: alert.events.map((event) => ({
			name: RESOURCE_LABELS[event.reading.kind],
			value: describeIncidentEvent(event, now),
		})),
		link: origin ? `${origin.replace(/\/+$/, "")}/` : null,
		serviceId: null,
		serviceName: null,
		timestamp,
		title: TITLES[alert.event][alert.reminder ? 1 : 0],
	};
}

/**
 * Watches the host's usage against the soft and hard thresholds in the
 * instance settings: alerts on crossings (in-app and on notification
 * channels) and refuses new services past a hard one.
 */
class CapacityServiceClass {
	readonly #tracker = new ResourceIncidentTracker();
	#restored = false;

	#latest: { at: number; readings: ResourceReading[] } | null = null;

	/**
	 * Evaluates one host sample, called by the stats sampler every minute:
	 * remembers it for `hardBreaches`, moves each resource's incident along
	 * (open once past a limit for the sustain window, escalate, remind,
	 * recover), records it, and sends the alerts that calls for. Picks up the
	 * incidents left open by the last run on its first call.
	 */
	async evaluate(host: HostUsageInput): Promise<void> {
		const settings = await InstanceSettingsDTO.get();
		const readings = readResources(host, settings.resourceThresholds);
		const now = Date.now();
		this.#latest = { at: now, readings };
		if (!this.#restored) {
			this.#tracker.restore(await ResourceIncidentDTO.listOpen());
			this.#restored = true;
		}
		const events = this.#tracker.next(readings, now, {
			reminderMs: settings.resourceAlertReminderMinutes * 60_000,
			sustainMs: settings.resourceAlertSustainSeconds * 1000,
		});
		await this.#record(events, now);
		for (const alert of groupIncidentEvents(events)) {
			const message = resourceAlertMessage(
				alert,
				config.auth.origin ?? null,
				new Date(now).toISOString(),
				now,
			);
			logger.info(
				`${message.title}: ${message.fields.map((f) => f.value).join(", ")}`,
			);
			NotificationDTO.notify({
				message: `${message.title}: ${message.fields.map((f) => f.value).join(", ")}`,
				type: "resource_alert",
			});
			NotificationChannelService.notify(message);
		}
	}

	/** Writes each event onto its incident's row: a new row when it opens, its alert count, level and peak after, its end when it recovers. */
	async #record(events: IncidentEvent[], now: number): Promise<void> {
		for (const event of events) {
			const { incident } = event;
			if (event.type === "open") {
				// oxlint-disable-next-line no-await-in-loop -- a check moves a handful of resources at most
				incident.id = await ResourceIncidentDTO.open(incident);
				continue;
			}
			if (!incident.id) {
				continue;
			}
			// oxlint-disable-next-line no-await-in-loop -- see above
			const count = await ResourceIncidentDTO.notificationCount(incident.id);
			// oxlint-disable-next-line no-await-in-loop -- see above
			await ResourceIncidentDTO.notified(
				incident,
				count + 1,
				event.type === "recover" ? new Date(now) : null,
			);
		}
	}

	/**
	 * The resources past their hard threshold right now: the stats sampler's
	 * last reading when it's recent, a fresh one otherwise. Empty when the
	 * host's stats can't be read, so a worker hiccup never blocks anyone.
	 */
	async hardBreaches(): Promise<ResourceReading[]> {
		if (!this.#latest || Date.now() - this.#latest.at > FRESH_MS) {
			try {
				const [host, settings] = await Promise.all([
					SystemStatsService.getSystemStats(),
					InstanceSettingsDTO.get(),
				]);
				this.#latest = {
					at: Date.now(),
					readings: readResources(host, settings.resourceThresholds),
				};
			} catch {
				return [];
			}
		}
		return this.#latest.readings.filter((reading) => reading.level === "hard");
	}

	/**
	 * Why a new service can't be added right now, naming every resource past
	 * its hard threshold, or null when there's room.
	 */
	async refusal(): Promise<string | null> {
		const breaches = await this.hardBreaches();
		return breaches.length > 0
			? `The server is past its hard resource limit (${breaches.map(describeReading).join(", ")}): free some up, or raise the limit in Settings, before adding a service.`
			: null;
	}

	/**
	 * Refuses a new service while the server is past a hard threshold.
	 *
	 * @throws CapacityError naming every resource over its hard limit.
	 */
	async assertRoomForNewService(): Promise<void> {
		const refusal = await this.refusal();
		if (refusal) {
			throw new CapacityError(refusal);
		}
	}
}

export const CapacityService = new CapacityServiceClass();
