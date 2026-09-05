import { Logger } from "$lib/logger";

const TICK_MS = 60_000;

// Survives Vite HMR the same way the db singleton does (db/lib.ts) : without
// this, every hot reload of a module in a scheduler's import chain would
// start a second interval, double-firing redeploys/backups/migrations.
// Keyed per subclass (see start() below) rather than one module-level flag
// per scheduler, so one starting never short-circuits another, same
// property the old three separate globalForCron/globalForBackup/
// globalForAutoscale guards had, just expressed as one shared registry now
// that each scheduler is its own class instead of a function in one file.
const globalForSchedulers = globalThis as unknown as {
	__scheduler_intervals?: Map<string, ReturnType<typeof setInterval>>;
};

function intervalRegistry(): Map<string, ReturnType<typeof setInterval>> {
	if (!globalForSchedulers.__scheduler_intervals) {
		globalForSchedulers.__scheduler_intervals = new Map();
	}
	return globalForSchedulers.__scheduler_intervals;
}

/**
 * Shared ticking-with-HMR-safe-guard boilerplate every scheduler in this
 * app needs (cron redeploy, S3 backup, autoscale migration, see the
 * sibling files in this directory, plus the job-queue worker in
 * services/queue/). A subclass just implements `tick()` and a
 * human-readable `label` for its log lines, optionally overriding
 * `intervalMs` (60s by default); `start()`, the interval, the
 * non-overlapping-tick guard and the double-start guard are all
 * inherited, not reimplemented per scheduler.
 */
export abstract class BaseScheduler {
	protected readonly logger = new Logger("Cron");

	/** Short label for this scheduler's own log lines (e.g. "Cron", "Backup", "Autoscale"). */
	protected abstract readonly label: string;

	protected readonly intervalMs: number = TICK_MS;

	private inFlight: Promise<void> | null = null;

	protected abstract tick(): Promise<void>;

	/** Starts this scheduler's own tick (see `intervalMs`). Idempotent : safe to call on every dev-server HMR reload. */
	start(): void {
		const registry = intervalRegistry();
		const key = this.constructor.name;
		if (registry.has(key)) {
			return;
		}

		this.logger.info(
			`${this.label} scheduler started (${this.intervalMs}ms tick).`,
		);
		registry.set(
			key,
			setInterval(() => {
				if (this.inFlight !== null) {
					return;
				}
				this.inFlight = this.tick()
					.catch((err) => this.logger.error(`${this.label} tick failed`, err))
					.finally(() => {
						this.inFlight = null;
					});
			}, this.intervalMs),
		);
	}
}
