import {
	type ActivityAlert,
	type ActivityDeployment,
	type ActivitySnapshot,
	lastLogLine,
} from "#lib/activity.js";
import { AppLogDTO } from "#lib/dto/app-log-dto.js";
import {
	type ActivityDeploymentRow,
	DeploymentDTO,
} from "#lib/dto/deployment-dto.js";
import { ErrorIssueDTO } from "#lib/dto/error-issue-dto.js";
import { JobDTO } from "#lib/dto/job-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";

const POLL_MS = 2000;
const HEARTBEAT_MS = 15_000;
const RECENT_LIMIT = 8;
const IN_FLIGHT_WINDOW_MS = 2 * 60 * 60 * 1000;
const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
const ALERT_LIMIT = 8;

const encoder = new TextEncoder();
const logger = new Logger("ActivityFeed");

type Listener = (payload: string) => void;

function toActivity(
	row: ActivityDeploymentRow & { log?: string | null },
): ActivityDeployment {
	return {
		createdAt: row.createdAt.toISOString(),
		environment: row.environment,
		errorMessage: row.errorMessage,
		finishedAt: row.finishedAt?.toISOString() ?? null,
		gitCommit: row.gitCommit,
		id: row.id,
		imageRef: row.imageRef,
		lastLine: lastLogLine(row.log ?? null),
		serviceId: row.serviceId,
		serviceName: row.serviceName,
		serviceSlug: row.serviceSlug,
		startedAt: row.startedAt?.toISOString() ?? null,
		status: row.status,
		trigger: row.trigger,
	};
}

/** Open error issues and service error logs from the last day, merged newest first, for services that still exist. */
async function recentAlerts(): Promise<ActivityAlert[]> {
	const since = new Date(Date.now() - ALERT_WINDOW_MS);
	const [issues, logs, services] = await Promise.all([
		ErrorIssueDTO.listOpenSeenSince(since, ALERT_LIMIT),
		AppLogDTO.listServiceErrorsSince(since, ALERT_LIMIT),
		ServiceDTO.list(),
	]);
	const names = new Map(services.map((svc) => [svc.id, svc.name]));
	const alerts: ActivityAlert[] = [
		...issues.map((issue) => ({
			at: issue.lastSeen.toISOString(),
			count: issue.count,
			detail: issue.culprit,
			id: issue.id,
			kind: "issue" as const,
			serviceId: issue.serviceId,
			serviceName: names.get(issue.serviceId) ?? "",
			title: issue.title,
		})),
		...logs.map((entry) => {
			const row = entry.toJSON();
			return {
				at: row.createdAt.toISOString(),
				count: 1,
				detail: row.scope,
				id: row.id,
				kind: "log" as const,
				serviceId: row.serviceId ?? "",
				serviceName: names.get(row.serviceId ?? "") ?? "",
				title: row.message,
			};
		}),
	];
	return alerts
		.filter((alert) => alert.serviceName !== "")
		.toSorted((a, b) => b.at.localeCompare(a.at))
		.slice(0, ALERT_LIMIT);
}

class ActivityFeedClass {
	#listeners = new Set<Listener>();
	#polling = false;
	#last: string | null = null;
	#lastBody = "";

	/**
	 * Reads what's deploying, what's queued, what deployed last and which services are erroring, in one
	 * round of queries. Non-deploy jobs only: a deploy's job is already its
	 * deployment row.
	 */
	async snapshot(): Promise<ActivitySnapshot> {
		const [deployments, jobs, alerts] = await Promise.all([
			DeploymentDTO.listActivity(RECENT_LIMIT, IN_FLIGHT_WINDOW_MS),
			JobDTO.listActive(),
			recentAlerts(),
		]);
		return {
			alerts,
			at: new Date().toISOString(),
			deploying: deployments.inFlight.map(toActivity),
			jobs: jobs
				.map((entry) => entry.toJSON())
				.filter((row) => row.type !== "deploy")
				.slice(0, 12)
				.map((row) => ({
					createdAt: row.createdAt.toISOString(),
					id: row.id,
					serviceId: row.serviceId,
					startedAt: row.startedAt?.toISOString() ?? null,
					status: row.status,
					title: row.title,
					type: row.type,
				})),
			recent: deployments.finished.map(toActivity),
		};
	}

	/**
	 * An SSE stream of activity snapshots: one at once, then another whenever
	 * the shared 2-second poll sees a change, with a keep-alive comment every
	 * 15 seconds. Every open stream shares one poller, which stops when the last
	 * one closes.
	 */
	stream(): ReadableStream<Uint8Array> {
		let listener: Listener | null = null;
		let beat: ReturnType<typeof setInterval> | null = null;
		const stop = () => {
			if (listener) {
				this.#listeners.delete(listener);
				listener = null;
			}
			if (beat) {
				clearInterval(beat);
				beat = null;
			}
			if (this.#listeners.size === 0) {
				this.#last = null;
			}
		};
		return new ReadableStream<Uint8Array>({
			cancel: stop,
			start: (controller) => {
				const write = (chunk: string) => {
					try {
						controller.enqueue(encoder.encode(chunk));
					} catch {
						stop();
					}
				};
				listener = (payload) => write(`event: activity\ndata: ${payload}\n\n`);
				this.#listeners.add(listener);
				beat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);
				if (this.#last) {
					listener(this.#last);
				}
				void this.#poll();
			},
		});
	}

	/** Polls every 2 seconds while anyone listens, broadcasting each snapshot whose content changed. A second call while it runs is a no-op. */
	async #poll(): Promise<void> {
		if (this.#polling) {
			return;
		}
		this.#polling = true;
		try {
			while (this.#listeners.size > 0) {
				// oxlint-disable-next-line no-await-in-loop -- the interval between polls is the point
				await this.#tick();
				// oxlint-disable-next-line no-await-in-loop -- the interval between polls is the point
				await new Promise((done) => setTimeout(done, POLL_MS));
			}
		} finally {
			this.#polling = false;
		}
	}

	/** One round of queries, sent to every listener when it differs from the last one sent. */
	async #tick(): Promise<void> {
		try {
			const snap = await this.snapshot();
			const body = JSON.stringify({ ...snap, at: "" });
			if (body !== this.#lastBody || !this.#last) {
				this.#lastBody = body;
				this.#last = JSON.stringify(snap);
				for (const listener of this.#listeners) {
					listener(this.#last);
				}
			}
		} catch (error) {
			logger.debug(`Activity poll failed: ${String(error)}`);
		}
	}
}

export const ActivityFeed = new ActivityFeedClass();
