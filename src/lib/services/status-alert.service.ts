import { isSmtpEnabled } from "$lib/config";
import { NotificationChannelDTO } from "$lib/dto/notification-channel-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { StatusPageDTO } from "$lib/dto/status-page-dto";
import type { ProbeResult } from "$lib/dto/uptime-check-dto";
import { Logger } from "$lib/logger";
import type { UptimeCheck } from "$lib/server/db/schema";
import { EmailService } from "./email.service";

const logger = new Logger("StatusAlerts");

const WEBHOOK_TIMEOUT_MS = 10_000;

export interface ProbeTransition {
	detail: string | null;
	kind: "internal" | "external";
	ok: boolean;
	serviceId: string;
}

export interface AlertPayload {
	detail: string | null;
	event: "service.down" | "service.up";
	kind: "internal" | "external";
	serviceId: string;
	serviceName: string;
	statusPage: string;
	timestamp: string;
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

export function alertSubject(payload: AlertPayload): string {
	const state = payload.event === "service.up" ? "recovered" : "is down";
	return `[${payload.statusPage}] ${payload.serviceName} ${state}`;
}

export function alertBody(payload: AlertPayload): string {
	const lines = [
		alertSubject(payload),
		"",
		`Service: ${payload.serviceName}`,
		`Probe: ${payload.kind}`,
		`At: ${payload.timestamp}`,
	];
	if (payload.detail) {
		lines.push(`Detail: ${payload.detail}`);
	}
	return lines.join("\n");
}

class StatusAlertServiceClass {
	async dispatch(
		transitions: ProbeTransition[],
		servicesById: Map<string, ServiceDTO>,
	): Promise<void> {
		await Promise.all(
			transitions.map(async (transition) => {
				const svc = servicesById.get(transition.serviceId);
				if (!svc) {
					return;
				}
				try {
					await this.#dispatchOne(transition, svc);
				} catch (err) {
					logger.error(
						`Alert dispatch failed: service=${transition.serviceId} : ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}),
		);
	}

	async #dispatchOne(
		transition: ProbeTransition,
		svc: ServiceDTO,
	): Promise<void> {
		const pages = await StatusPageDTO.listCovering(
			svc.userId,
			svc.id,
			svc.projectId,
		);
		await Promise.all(
			pages.map(async (page) => {
				const channels = await NotificationChannelDTO.listForStatusPage(
					svc.userId,
					page.id,
				);
				if (channels.length === 0) {
					return;
				}
				const payload: AlertPayload = {
					detail: transition.detail,
					event: transition.ok ? "service.up" : "service.down",
					kind: transition.kind,
					serviceId: svc.id,
					serviceName: svc.name,
					statusPage: page.name,
					timestamp: new Date().toISOString(),
				};
				await Promise.all(
					channels.map((channel) => this.#send(channel, payload)),
				);
			}),
		);
	}

	async #send(
		channel: NotificationChannelDTO,
		payload: AlertPayload,
	): Promise<void> {
		try {
			if (channel.kind === "webhook") {
				await this.#sendWebhook(channel.target, payload);
			} else {
				await this.#sendEmail(channel.target, payload);
			}
			await channel.update({ lastError: null });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.warn(`Channel "${channel.name}" failed: ${message}`);
			await channel.update({ lastError: message });
		}
	}

	async #sendWebhook(url: string, payload: AlertPayload): Promise<void> {
		const response = await fetch(url, {
			body: JSON.stringify(payload),
			headers: { "content-type": "application/json" },
			method: "POST",
			signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(`Webhook returned HTTP ${response.status}`);
		}
	}

	async #sendEmail(to: string, payload: AlertPayload): Promise<void> {
		if (!isSmtpEnabled()) {
			throw new Error("SMTP isn't configured, so email alerts can't be sent.");
		}
		await new EmailService({
			content: alertBody(payload),
			subject: alertSubject(payload),
			to,
		}).send();
	}

	async sendTest(channel: NotificationChannelDTO): Promise<void> {
		const payload: AlertPayload = {
			detail: "This is a test alert from Homerun.",
			event: "service.down",
			kind: "internal",
			serviceId: "test",
			serviceName: "Test service",
			statusPage: "Test",
			timestamp: new Date().toISOString(),
		};
		if (channel.kind === "webhook") {
			await this.#sendWebhook(channel.target, payload);
		} else {
			await this.#sendEmail(channel.target, payload);
		}
		await channel.update({ lastError: null });
	}
}

export const StatusAlertService = new StatusAlertServiceClass();
