import {
	type NewNotificationInput,
	NotificationDTO,
} from "#lib/dto/notification-dto.js";

export const DIGEST_QUIET_MS = 90_000;
export const DIGEST_MAX_HOLD_MS = 10 * 60_000;

export interface ScheduledOutcome {
	error?: string;
	ok: boolean;
	serviceId: string;
	serviceName: string;
}

/**
 * The bell entries for a batch of scheduled-redeploy outcomes: one for the
 * successes and one for the failures, each error listed. A side with a single
 * outcome keeps the message a lone redeploy has always had.
 */
export function digestNotifications(
	outcomes: ScheduledOutcome[],
): NewNotificationInput[] {
	const entries: NewNotificationInput[] = [];
	const succeeded = outcomes.filter((outcome) => outcome.ok);
	const failed = outcomes.filter((outcome) => !outcome.ok);
	const [onlySuccess] = succeeded;
	if (succeeded.length === 1 && onlySuccess) {
		entries.push({
			message: `"${onlySuccess.serviceName}" was auto-redeployed.`,
			serviceId: onlySuccess.serviceId,
			type: "auto_redeploy",
		});
	} else if (succeeded.length > 1) {
		entries.push({
			message: `${succeeded.length} services were auto-redeployed: ${succeeded.map((o) => o.serviceName).join(", ")}.`,
			type: "auto_redeploy",
		});
	}
	const [onlyFailure] = failed;
	if (failed.length === 1 && onlyFailure) {
		entries.push({
			message: `"${onlyFailure.serviceName}" failed to deploy: ${onlyFailure.error ?? "unknown error"}`,
			serviceId: onlyFailure.serviceId,
			type: "deploy_failure",
		});
	} else if (failed.length > 1) {
		entries.push({
			message: `${failed.length} scheduled redeploys failed: ${failed.map((o) => `${o.serviceName} (${o.error ?? "unknown error"})`).join("; ")}`,
			type: "deploy_failure",
		});
	}
	return entries;
}

/**
 * Holds scheduled-redeploy outcomes for the bell, so a shared schedule
 * redeploying a dozen services leaves one success entry and one failure
 * entry instead of a dozen: flushed once `DIGEST_QUIET_MS` pass without a
 * new outcome, or `DIGEST_MAX_HOLD_MS` after the first. Channel messages are
 * grouped separately, by `NotificationGrouper`.
 */
export class ScheduledBellDigestClass {
	readonly #notify: (entry: NewNotificationInput) => void;
	#outcomes: ScheduledOutcome[] = [];
	#firstAt = 0;
	#timer: ReturnType<typeof setTimeout> | null = null;

	/** A digest writing its entries through `notify`, every account's bell by default. */
	constructor(
		notify: (entry: NewNotificationInput) => void = (entry) =>
			NotificationDTO.notify(entry),
	) {
		this.#notify = notify;
	}

	/** Buffers one outcome and (re)arms the flush. */
	add(outcome: ScheduledOutcome): void {
		const now = Date.now();
		if (this.#outcomes.length === 0) {
			this.#firstAt = now;
		}
		this.#outcomes.push(outcome);
		if (this.#timer) {
			clearTimeout(this.#timer);
		}
		const wait = Math.min(
			DIGEST_QUIET_MS,
			Math.max(0, this.#firstAt + DIGEST_MAX_HOLD_MS - now),
		);
		this.#timer = setTimeout(() => this.flush(), wait);
	}

	/** Writes the buffered outcomes to every bell now, as digest entries. */
	flush(): void {
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		const outcomes = this.#outcomes;
		this.#outcomes = [];
		for (const entry of digestNotifications(outcomes)) {
			this.#notify(entry);
		}
	}
}

export const ScheduledBellDigest = new ScheduledBellDigestClass();
