import { config } from "#lib/config.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { NotificationDTO } from "#lib/dto/notification-dto.js";
import { ResourceIncidentDTO } from "#lib/dto/resource-incident-dto.js";
import { Logger } from "#lib/logger.js";
import {
	describeCauses,
	describeIncidentEvent,
	type IncidentEvent,
	type IncidentSample,
	ResourceIncidentTracker,
	toIncidentSample,
} from "#lib/resource-incidents.js";
import {
	describeReading,
	type HostUsageInput,
	readResources,
	RESOURCE_LABELS,
	type ResourceKind,
	type ResourceReading,
} from "#lib/resource-thresholds.js";

import type { AgentConnection } from "./agent-client.service.ts";
import { NotificationChannelService } from "./notification-channel.service.ts";
import type { ChannelMessage } from "./notification-messages.ts";
import {
	type InsightResource,
	ResourceInsightsService,
} from "./resource-insights.service.ts";
import { SystemStatsService } from "./system-stats.service.ts";

const logger = new Logger("Capacity");

const FRESH_MS = 3 * 60 * 1000;

/** How long a host's last reading stays on the Incidents page without a newer one. */
const WATCH_MS = 5 * 60 * 1000;

/** A remote host the stats sampler measures through its agent. */
export interface WatchedRemoteHost {
	connection: AgentConnection;
	id: string;
	name: string;
}

/** What the last check read on one host: this server when `remoteHostId` is null. */
export interface HostWatch {
	at: number;
	name: string;
	readings: ResourceReading[];
	remoteHostId: string | null;
}

/** One host's incident state: its tracker, whether it picked up the open incidents yet, and its last few readings. */
interface HostIncidents {
	recent: IncidentSample[];
	restored: boolean;
	tracker: ResourceIncidentTracker;
}

/** Which live reading explains each resource, null for one with none. */
const INSIGHT_KINDS: Record<ResourceKind, InsightResource | null> = {
	cpu: "cpu",
	disk: "disk",
	gpu: null,
	memory: "memory",
};

/** Thrown when a new service is refused because the server is past a hard threshold. */
export class CapacityError extends Error {}

export type ResourceAlertEvent =
	"resource.critical" | "resource.recovered" | "resource.warning";

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

/** An alert's title, naming the remote host it's about, or "Server" for this one. */
function alertTitle(
	event: ResourceAlertEvent,
	reminder: boolean,
	hostName: string | null,
): string {
	const subject = hostName ?? "Server";
	switch (event) {
		case "resource.critical":
			return reminder
				? `${subject} still past a hard resource limit`
				: `${subject} past a hard resource limit`;
		case "resource.warning":
			return reminder
				? `${subject} resources still running high`
				: `${subject} resources running high`;
		default:
			return `${subject} resources back to normal`;
	}
}

/**
 * The channel message for a resource alert: a host-wide one, with no
 * service attached, about this server or the remote host `options.hostName`
 * names, timed at `options.now` (`timestamp` by default).
 */
export function resourceAlertMessage(
	alert: ResourceAlert,
	origin: string | null,
	timestamp: string,
	options: { hostName?: string | null; now?: number } = {},
): ChannelMessage {
	const hostName = options.hostName ?? null;
	const now = options.now ?? Date.parse(timestamp);
	return {
		detail:
			alert.event === "resource.critical" && hostName === null
				? "New services are refused until usage drops back under the hard limit."
				: null,
		event: alert.event,
		fields: alert.events.flatMap((event) => {
			const field = {
				name: RESOURCE_LABELS[event.reading.kind],
				value: describeIncidentEvent(event, now),
			};
			return event.type === "recover" || event.incident.causes.length === 0
				? [field]
				: [
						field,
						{
							name: `${RESOURCE_LABELS[event.reading.kind]}: biggest users`,
							value: describeCauses(event.incident.causes),
						},
					];
		}),
		link: origin ? `${origin.replace(/\/+$/, "")}/monitoring/incidents` : null,
		serviceId: null,
		serviceName: null,
		timestamp,
		title: alertTitle(alert.event, alert.reminder, hostName),
	};
}

/**
 * Watches this server's usage, and every remote host's its agent reports,
 * against the soft and hard thresholds in the instance settings: records an
 * incident per resource per host, alerts on crossings (in-app and on
 * notification channels) and refuses new services while this server is past
 * a hard one.
 */
class CapacityServiceClass {
	readonly #hosts = new Map<string, HostIncidents>();

	readonly #watched = new Map<string, HostWatch>();

	#latest: { at: number; readings: ResourceReading[] } | null = null;

	/**
	 * Evaluates one host sample, called by the stats sampler every minute for
	 * this server and for each remote host whose agent answered: remembers
	 * it for `hardBreaches` (this server only) and `watched`, moves each
	 * resource's incident along (open once past a limit for the sustain
	 * window, escalate, remind, recover), records it with the reading, and
	 * sends the alerts that calls for. Picks up the host's incidents left
	 * open by the last run on its first call.
	 */
	async evaluate(
		host: HostUsageInput,
		remote: WatchedRemoteHost | null = null,
	): Promise<void> {
		const settings = await InstanceSettingsDTO.get();
		const readings = readResources(host, settings.resourceThresholds);
		const now = Date.now();
		const remoteHostId = remote?.id ?? null;
		if (!remote) {
			this.#latest = { at: now, readings };
		}
		this.#watched.set(remoteHostId ?? "", {
			at: now,
			name: remote?.name ?? "This server",
			readings,
			remoteHostId,
		});
		const state = await this.#state(remoteHostId);
		const sustainMs = settings.resourceAlertSustainSeconds * 1000;
		const sample = toIncidentSample(readings, now);
		state.recent = [
			...state.recent.filter((kept) => now - kept.at <= sustainMs + FRESH_MS),
			sample,
		];
		const events = state.tracker.next(readings, now, {
			reminderMs: settings.resourceAlertReminderMinutes * 60_000,
			sustainMs,
		});
		await this.#explain(events, remote);
		await this.#record(events, now, remoteHostId, state.recent);
		const opened = new Set(
			events
				.filter((event) => event.type === "open")
				.map((event) => event.incident),
		);
		await ResourceIncidentDTO.addSample(
			[
				...state.tracker.open().filter((incident) => !opened.has(incident)),
				...events
					.filter((event) => event.type === "recover")
					.map((event) => event.incident),
			],
			sample,
		);
		for (const alert of groupIncidentEvents(events)) {
			const message = resourceAlertMessage(
				alert,
				config.auth.origin ?? null,
				new Date(now).toISOString(),
				{ hostName: remote?.name ?? null, now },
			);
			logger.info(
				`${message.title}: ${message.fields.map((f) => f.value).join(", ")}`,
			);
			NotificationDTO.notify({
				message: `${message.title}: ${alert.events
					.map((event) =>
						event.type === "recover" || event.incident.causes.length === 0
							? describeIncidentEvent(event, now)
							: `${describeIncidentEvent(event, now)} (biggest users: ${describeCauses(event.incident.causes)})`,
					)
					.join(", ")}`,
				type: "resource_alert",
			});
			NotificationChannelService.notify(message);
		}
	}

	/** Every host read in the last few minutes, this server first, then the remote hosts by name. */
	watched(now = Date.now()): HostWatch[] {
		return [...this.#watched.values()]
			.filter((watch) => now - watch.at <= WATCH_MS)
			.toSorted((a, b) =>
				a.remoteHostId === null
					? -1
					: b.remoteHostId === null
						? 1
						: a.name.localeCompare(b.name),
			);
	}

	/** One host's incident state, its open incidents picked up from the database the first time. */
	async #state(remoteHostId: string | null): Promise<HostIncidents> {
		const key = remoteHostId ?? "";
		let state = this.#hosts.get(key);
		if (!state) {
			state = {
				recent: [],
				restored: false,
				tracker: new ResourceIncidentTracker(),
			};
			this.#hosts.set(key, state);
		}
		if (!state.restored) {
			state.tracker.restore(await ResourceIncidentDTO.listOpen(remoteHostId));
			state.restored = true;
		}
		return state;
	}

	/**
	 * Records why each alerting event fired: the resource's biggest consumers
	 * right now, read once per resource, onto its incident. This server names
	 * its containers and processes, a remote host its agent's processes. A
	 * recovery keeps the causes of the last alert; a GPU has no per-container
	 * reading to name.
	 */
	async #explain(
		events: IncidentEvent[],
		remote: WatchedRemoteHost | null,
	): Promise<void> {
		const alerting = events.filter((event) => event.type !== "recover");
		const resources = [
			...new Set(alerting.map((event) => INSIGHT_KINDS[event.reading.kind])),
		].filter((resource): resource is InsightResource => resource !== null);
		const causes = new Map(
			await Promise.all(
				resources.map(
					async (resource) =>
						[
							resource,
							remote
								? await ResourceInsightsService.remoteCauses(
										remote.connection,
										resource,
									)
								: await ResourceInsightsService.causes(resource),
						] as const,
				),
			),
		);
		for (const event of alerting) {
			const resource = INSIGHT_KINDS[event.reading.kind];
			event.incident.causes = (resource && causes.get(resource)) || [];
		}
	}

	/**
	 * Writes each event onto its incident's row: a new row when it opens, with
	 * the readings since its breach began, its alert count, level, peak and
	 * causes after, its end when it recovers.
	 */
	async #record(
		events: IncidentEvent[],
		now: number,
		remoteHostId: string | null,
		recent: IncidentSample[],
	): Promise<void> {
		for (const event of events) {
			const { incident } = event;
			if (event.type === "open") {
				// oxlint-disable-next-line no-await-in-loop -- a check moves a handful of resources at most
				incident.id = await ResourceIncidentDTO.open(
					incident,
					remoteHostId,
					recent.filter((sample) => sample.at >= incident.startedAt),
				);
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
