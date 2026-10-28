import { LogHistoryService } from "../log-history.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const HOUR_MS = 60 * 60 * 1000;

/** Hourly retention pass over stored service logs. */
export class LogRetentionScheduler extends BaseScheduler {
	protected readonly label: string;

	protected readonly intervalMs: number;

	/** Ticks hourly under the `LogRetention` label. */
	constructor() {
		super();
		this.label = "LogRetention";
		this.intervalMs = HOUR_MS;
	}

	/** Runs `LogHistoryService.prune`. */
	protected async tick(): Promise<void> {
		await LogHistoryService.prune();
	}
}
