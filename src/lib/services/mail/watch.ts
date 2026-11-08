import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { MailMailboxDTO } from "#lib/dto/mail-mailbox-dto.js";
import { NotificationDTO } from "#lib/dto/notification-dto.js";
import { Logger } from "#lib/logger.js";
import {
	type DeliveryFailure,
	deliveryFailures,
	failureKey,
	failuresSince,
	parseMailLog,
} from "#lib/mail-log.js";

import { DockerService } from "../docker.service.ts";
import { MailService } from "../mail.service.ts";

const logger = new Logger("Mail");

const WATCH_LOG_TAIL = 2000;
const LISTED_FAILURES = 5;

/** One line per failure, for a notification's detail. */
function describeFailures(failures: DeliveryFailure[]): string {
	const lines = failures
		.slice(-LISTED_FAILURES)
		.map(
			(failure) =>
				`${failure.status} to ${failure.recipient}: ${failure.reason}`,
		);
	const more = failures.length - LISTED_FAILURES;
	return more > 0
		? [...lines, `…and ${more} more.`].join("\n")
		: lines.join("\n");
}

/**
 * Watches the mail server between page loads and raises a notification when
 * something goes wrong: the container stops or crash-loops while it should
 * run, or messages bounce or get deferred. It remembers what it already
 * reported, so a state is notified once when it starts, not on every pass.
 */
class MailWatchServiceClass {
	#lastHealth: string | null = null;
	#since: string | null = null;
	#reportedAtSince = new Set<string>();

	/** One pass: checks the container, then the log since the previous pass. */
	async check(): Promise<void> {
		const row = (await InstanceSettingsDTO.get()).toJSON();
		const mailboxes = (await MailMailboxDTO.list()).filter(
			(box) => box.toJSON().enabled,
		);
		const hostname = await MailService.hostname();
		if (row.mailEnabled !== true || mailboxes.length === 0 || !hostname) {
			this.#lastHealth = null;
			return;
		}
		await this.#checkHealth();
		await this.#checkDeliveries();
	}

	/** Notifies when the container stops running or keeps restarting, once per state. */
	async #checkHealth(): Promise<void> {
		const health = await DockerService.mailHealth();
		const state = health.running
			? "running"
			: health.restarting
				? "restarting"
				: health.exists
					? "stopped"
					: "missing";
		if (state === this.#lastHealth) {
			return;
		}
		const previous = this.#lastHealth;
		this.#lastHealth = state;
		if (state === "running") {
			if (previous && previous !== "running") {
				NotificationDTO.notify({
					message: "The mail server is running again.",
					type: "mail_failure",
				});
			}
			return;
		}
		const exit =
			health.exitCode === null ? "" : ` Last exit code ${health.exitCode}.`;
		const message =
			state === "restarting"
				? `The mail server keeps restarting (${health.restartCount} restarts).${exit}`
				: state === "stopped"
					? `The mail server's container stopped.${exit}`
					: "The mail server's container is gone.";
		logger.warn(message);
		NotificationDTO.notify({
			detail: health.error ?? "See Mail → Logs for what it printed last.",
			message,
			type: "mail_failure",
		});
	}

	/** Notifies the bounces and deferrals logged since the previous pass; the first pass only sets the starting point. */
	async #checkDeliveries(): Promise<void> {
		const lines = parseMailLog(await DockerService.mailLogs(WATCH_LOG_TAIL));
		const failures = deliveryFailures(lines);
		const latest = lines.findLast((line) => line.time)?.time ?? null;
		const atLatest = (since: string | null) =>
			new Set(
				failures
					.filter(
						(failure) =>
							since !== null &&
							failure.time !== null &&
							Date.parse(failure.time) === Date.parse(since),
					)
					.map(failureKey),
			);
		if (this.#since === null) {
			this.#since = latest ?? new Date().toISOString();
			this.#reportedAtSince = atLatest(this.#since);
			return;
		}
		const fresh = failuresSince(failures, this.#since, this.#reportedAtSince);
		const previous = this.#since;
		this.#since = latest ?? this.#since;
		this.#reportedAtSince =
			this.#since === previous
				? new Set([...this.#reportedAtSince, ...atLatest(this.#since)])
				: atLatest(this.#since);
		if (fresh.length === 0) {
			return;
		}
		const bounced = fresh.filter((failure) => failure.status === "bounced");
		NotificationDTO.notify({
			detail: describeFailures(fresh),
			message:
				bounced.length > 0
					? `${bounced.length} outgoing messages bounced.`
					: `${fresh.length} outgoing messages are delayed and will be retried.`,
			type: "mail_failure",
		});
	}

	/** Reports a failed configuration sync, which otherwise only shows in the job's log. */
	syncFailed(err: unknown): void {
		NotificationDTO.notify({
			detail: err instanceof Error ? err.message : String(err),
			message: "Couldn't apply the mail server's configuration.",
			type: "mail_failure",
		});
	}
}

export const MailWatchService = new MailWatchServiceClass();
