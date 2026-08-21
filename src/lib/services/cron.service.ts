// CronService : facade over the three independent 60s-tick schedulers this
// app runs (cron redeploy, S3 backup, autoscale migration, see
// services/cron/*) plus the standalone cron-expression parser two route
// files use for schedule validation.
//
// Each scheduler is its own real class extending BaseScheduler
// (services/cron/base-scheduler.ts) : this file composes one instance of
// each rather than being a bag of loose exported functions itself (see
// docker.service.ts / the OOP convention note in CLAUDE.md). Unlike
// DockerService's concerns, these three schedulers don't call into each
// other, so composition (not the mixin-merge pattern DockerService uses)
// is the natural fit, a static method here just delegates one call into
// the composed instance it owns.

import { AutoscaleScheduler } from "./cron/autoscale-scheduler.ts";
import { BackupScheduler } from "./cron/backup-scheduler.ts";
import {
	cronMatches,
	type ParsedCron,
	parseCronSchedule,
} from "./cron/cron-expression.ts";
import { CronRedeployScheduler } from "./cron/cron-redeploy-scheduler.ts";

export type { ParsedCron } from "./cron/cron-expression.ts";

export class CronService {
	private static readonly redeployScheduler = new CronRedeployScheduler();
	private static readonly backupScheduler = new BackupScheduler();
	private static readonly autoscaleScheduler = new AutoscaleScheduler();

	/** Parses a 5-field cron expression, or null if it's malformed. */
	static parseCronSchedule(schedule: string): ParsedCron | null {
		return parseCronSchedule(schedule);
	}

	/** Whether the given schedule is due at the given date (minute resolution : seconds are ignored). */
	static cronMatches(schedule: string, date: Date): boolean {
		return cronMatches(schedule, date);
	}

	/** Starts the once-a-minute cron redeploy check. Idempotent : safe to call on every dev-server HMR reload. */
	static startCronScheduler(): void {
		CronService.redeployScheduler.start();
	}

	/** Starts the once-a-minute scheduled-backup check. Idempotent : safe to call on every dev-server HMR reload. */
	static startBackupScheduler(): void {
		CronService.backupScheduler.start();
	}

	/**
	 * Starts the once-a-minute autoscale check. Idempotent : safe to call on
	 * every dev-server HMR reload. A no-op every tick unless
	 * instanceSettings.autoscaleEnabled is on *and* an overflow remote host
	 * is configured (Settings' Autoscaling section) : same opt-in-and-inert-
	 * by-default posture as the other two schedulers here.
	 */
	static startAutoscaleScheduler(): void {
		CronService.autoscaleScheduler.start();
	}
}
