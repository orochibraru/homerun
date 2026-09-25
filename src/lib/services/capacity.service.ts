import { config } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { Logger } from "$lib/logger";
import {
	describeReading,
	type HostUsageInput,
	RESOURCE_LABELS,
	type ResourceKind,
	type ResourceLevel,
	type ResourceReading,
	readResources,
} from "$lib/resource-thresholds";
import { NotificationChannelService } from "./notification-channel.service.ts";
import type { ChannelMessage } from "./notification-messages.ts";
import { SystemStatsService } from "./system-stats.service.ts";

const logger = new Logger("Capacity");

const FRESH_MS = 3 * 60 * 1000;

const RANK: Record<ResourceLevel, number> = { hard: 2, ok: 0, soft: 1 };

/** Thrown when a new service is refused because the server is past a hard threshold. */
export class CapacityError extends Error {}

export interface ResourceAlert {
	event: "resource.critical" | "resource.recovered" | "resource.warning";
	readings: ResourceReading[];
}

/**
 * Turns successive readings into the alerts worth sending: one when a
 * resource climbs to a higher level than it was already alerted at, and one
 * "recovered" when every alerted resource is back under its soft threshold.
 * A resource hovering above a threshold alerts once, not every minute.
 */
export class ResourceAlertTracker {
	readonly #alerted = new Map<ResourceKind, ResourceLevel>();

	/** The alerts this reading calls for, in the order to send them. */
	next(readings: ResourceReading[]): ResourceAlert[] {
		const escalated = readings.filter(
			(reading) =>
				RANK[reading.level] > RANK[this.#alerted.get(reading.kind) ?? "ok"],
		);
		const wasAlerting = [...this.#alerted.values()].some(
			(level) => level !== "ok",
		);
		for (const reading of readings) {
			const alerted = this.#alerted.get(reading.kind) ?? "ok";
			if (RANK[reading.level] > RANK[alerted] || reading.level === "ok") {
				this.#alerted.set(reading.kind, reading.level);
			}
		}
		const alerts: ResourceAlert[] = [];
		const hard = escalated.filter((reading) => reading.level === "hard");
		const soft = escalated.filter((reading) => reading.level === "soft");
		if (hard.length > 0) {
			alerts.push({ event: "resource.critical", readings: hard });
		}
		if (soft.length > 0) {
			alerts.push({ event: "resource.warning", readings: soft });
		}
		const nowAlerting = [...this.#alerted.values()].some(
			(level) => level !== "ok",
		);
		if (wasAlerting && !nowAlerting) {
			alerts.push({ event: "resource.recovered", readings });
		}
		return alerts;
	}
}

/** The channel message for a resource alert: a server-wide one, with no service attached. */
export function resourceAlertMessage(
	alert: ResourceAlert,
	origin: string | null,
	timestamp: string,
): ChannelMessage {
	const titles: Record<ResourceAlert["event"], string> = {
		"resource.critical": "Server past a hard resource limit",
		"resource.recovered": "Server resources back to normal",
		"resource.warning": "Server resources running high",
	};
	return {
		detail:
			alert.event === "resource.critical"
				? "New services are refused until usage drops back under the hard limit."
				: null,
		event: alert.event,
		fields: alert.readings.map((reading) => ({
			name: RESOURCE_LABELS[reading.kind],
			value:
				alert.event === "resource.recovered"
					? `${reading.percent}%`
					: describeReading(reading),
		})),
		link: origin ? `${origin.replace(/\/+$/, "")}/` : null,
		serviceId: null,
		serviceName: null,
		timestamp,
		title: titles[alert.event],
	};
}

/**
 * Watches the host's usage against the soft and hard thresholds in the
 * instance settings: alerts on crossings (in-app and on notification
 * channels) and refuses new services past a hard one.
 */
class CapacityServiceClass {
	readonly #tracker = new ResourceAlertTracker();

	#latest: { at: number; readings: ResourceReading[] } | null = null;

	/**
	 * Evaluates one host sample, called by the stats sampler every minute:
	 * remembers it for `hardBreaches`, and sends whatever alerts it calls for.
	 */
	async evaluate(host: HostUsageInput): Promise<void> {
		const settings = await InstanceSettingsDTO.get();
		const readings = readResources(host, settings.resourceThresholds);
		this.#latest = { at: Date.now(), readings };
		for (const alert of this.#tracker.next(readings)) {
			const message = resourceAlertMessage(
				alert,
				config.auth.origin ?? null,
				new Date().toISOString(),
			);
			logger.info(
				`${message.title}: ${message.fields.map((f) => `${f.name} ${f.value}`).join(", ")}`,
			);
			NotificationDTO.notify({
				message: `${message.title}: ${message.fields.map((f) => f.value).join(", ")}`,
				type: "resource_alert",
			});
			NotificationChannelService.notify(message);
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
