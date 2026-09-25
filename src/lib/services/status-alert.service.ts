import { config } from "$lib/config";
import type { ServiceDTO } from "$lib/dto/service-dto";
import type { ProbeResult } from "$lib/dto/uptime-check-dto";
import { Logger } from "$lib/logger";
import type { UptimeCheck } from "$lib/server/db/schema";
import { NotificationChannelService } from "./notification-channel.service";
import { uptimeMessage } from "./notification-messages";

const logger = new Logger("StatusAlerts");

export interface ProbeTransition {
	detail: string | null;
	kind: "internal" | "external";
	ok: boolean;
	serviceId: string;
}

/** Diffs a fresh batch of probe results against each check's previous `ok` state, returning only the ones whose state actually flipped (a new check with no prior state is not a transition). */
export function detectTransitions(
	previous: Map<string, Pick<UptimeCheck, "ok">>,
	results: ProbeResult[],
): ProbeTransition[] {
	const transitions: ProbeTransition[] = [];
	for (const result of results) {
		const prior = previous.get(`${result.serviceId}:${result.kind}`);
		if (prior === undefined || prior.ok === result.ok) {
			continue;
		}
		transitions.push({
			detail: result.detail ?? null,
			kind: result.kind,
			ok: result.ok,
			serviceId: result.serviceId,
		});
	}
	return transitions;
}

export const RECOVERY_STABLE_MS = 15 * 60_000;

/**
 * Turns raw probe transitions into the alerts worth sending, so a service that
 * flaps (a swarm task that passes its healthcheck for a while, then fails it
 * again, forever) alerts once instead of on every cycle. A probe that goes
 * down alerts only if it wasn't already down; its recovery alerts only once
 * it has stayed up for `RECOVERY_STABLE_MS`, and a failure before then is
 * silent, since the down alert still stands. State lives in memory: a restart
 * forgets it, which at worst sends one extra alert.
 */
export class AlertDamper {
	readonly #upSince = new Map<string, number | null>();

	/** The alerts to dispatch for this tick's `transitions`, given every result of the tick and the current time. */
	alerts(
		transitions: ProbeTransition[],
		results: ProbeResult[],
		now: number,
	): ProbeTransition[] {
		const alerts: ProbeTransition[] = [];
		for (const transition of transitions) {
			const key = `${transition.serviceId}:${transition.kind}`;
			if (!(transition.ok || this.#upSince.has(key))) {
				alerts.push(transition);
			}
			if (!this.#upSince.has(key) || !transition.ok) {
				this.#upSince.set(key, null);
			}
		}
		for (const result of results) {
			const key = `${result.serviceId}:${result.kind}`;
			if (!this.#upSince.has(key)) {
				continue;
			}
			if (!result.ok) {
				this.#upSince.set(key, null);
				continue;
			}
			const since = this.#upSince.get(key) ?? now;
			if (now - since < RECOVERY_STABLE_MS) {
				this.#upSince.set(key, since);
				continue;
			}
			this.#upSince.delete(key);
			alerts.push({
				detail: result.detail ?? null,
				kind: result.kind,
				ok: true,
				serviceId: result.serviceId,
			});
		}
		return alerts;
	}
}

class StatusAlertServiceClass {
	/** Sends an uptime notification for each transition to every account's channels via `NotificationChannelService`. Per-transition failures are logged and don't stop the others from dispatching. */
	async dispatch(
		transitions: ProbeTransition[],
		servicesById: Map<string, { host: string | null; svc: ServiceDTO }>,
	): Promise<void> {
		await Promise.all(
			transitions.map(async (transition) => {
				const entry = servicesById.get(transition.serviceId);
				if (!entry) {
					return;
				}
				const { host, svc } = entry;
				try {
					await NotificationChannelService.dispatch(
						uptimeMessage(
							{
								detail: transition.detail,
								kind: transition.kind,
								ok: transition.ok,
								origin: config.auth.origin ?? null,
								publicHost: host,
								service: { id: svc.id, name: svc.name },
							},
							new Date().toISOString(),
						),
					);
				} catch (err) {
					logger.error(
						`Alert dispatch failed: service=${transition.serviceId} : ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}),
		);
	}
}

export const StatusAlertService = new StatusAlertServiceClass();
