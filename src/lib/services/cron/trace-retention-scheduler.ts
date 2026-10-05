import { TracingService } from "../tracing.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const HOUR_MS = 60 * 60 * 1000;

/** Hourly retention pass over stored trace spans. */
export class TraceRetentionScheduler extends BaseScheduler {
	protected readonly label: string;

	protected readonly intervalMs: number;

	/** Ticks hourly under the `TraceRetention` label. */
	constructor() {
		super();
		this.label = "TraceRetention";
		this.intervalMs = HOUR_MS;
	}

	/** Runs `TracingService.prune`. */
	protected async tick(): Promise<void> {
		await TracingService.prune();
	}
}
