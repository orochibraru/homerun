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

class StatusAlertServiceClass {
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
						svc.userId,
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
