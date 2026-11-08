import { MailWatchService } from "../mail/watch.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Five-minute pass over the mail server's container and log, notifying what went wrong. */
export class MailWatchScheduler extends BaseScheduler {
	protected readonly label: string;
	protected readonly intervalMs = FIVE_MINUTES_MS;
	protected readonly runOnStart = true;

	/** Ticks every five minutes under the `MailWatch` label. */
	constructor() {
		super();
		this.label = "MailWatch";
	}

	/** Runs `MailWatchService.check`. */
	protected async tick(): Promise<void> {
		await MailWatchService.check();
	}
}
