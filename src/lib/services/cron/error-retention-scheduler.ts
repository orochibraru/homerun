import { ErrorTrackingService } from "../error-tracking.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const HOUR_MS = 60 * 60 * 1000;

/** Hourly retention pass over error tracking: events past the window, and closed issues not seen within it. */
export class ErrorRetentionScheduler extends BaseScheduler {
	protected readonly label: string;

	protected readonly intervalMs: number;

	/** Ticks hourly under the `ErrorRetention` label. */
	constructor() {
		super();
		this.label = "ErrorRetention";
		this.intervalMs = HOUR_MS;
	}

	/** Runs `ErrorTrackingService.prune`. */
	protected async tick(): Promise<void> {
		await ErrorTrackingService.prune();
	}
}
