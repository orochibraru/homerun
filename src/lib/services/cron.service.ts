// CronService : facade over the three independent 60s-tick schedulers this
// app runs (cron redeploy, S3 backup, user cron jobs, see
// services/cron/*) plus the standalone cron-expression parser two route
// files use for schedule validation.
//
// Each scheduler is its own real class extending BaseScheduler
// (services/cron/base-scheduler.ts) : this file composes one instance of
// each rather than being a bag of loose exported functions itself (see
// docker.service.ts / the OOP convention note in CLAUDE.md). Unlike
// DockerService's concerns, these three schedulers don't call into each
// other, so composition (not the mixin-merge pattern DockerService uses)
// is the natural fit, a method here just delegates one call into the
// composed instance it owns.

import { CronJobDTO } from "$lib/dto/cron-job-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { enqueueVolumeBackup } from "./backup-queue.ts";
import { CoreServicesWatch } from "./cron/core-services-watch.ts";
import { type ParsedCron, parseCronSchedule } from "./cron/cron-expression.ts";
import { DueScheduler } from "./cron/due-scheduler.ts";
import { GitPollScheduler } from "./cron/git-poll-scheduler.ts";
import { MirrorGcScheduler } from "./cron/mirror-gc-scheduler.ts";
import { SwarmDnsWatch } from "./cron/swarm-dns-watch.ts";
import { enqueueCronJobRun } from "./cron-job-queue.ts";
import { DeploymentService } from "./deploy.service.ts";
import { StatsSampler } from "./stats/stats-sampler.ts";
import { BOOT_QUIET_MS, quietUptimeProbes } from "./uptime/quiet.ts";
import { UptimeProbe } from "./uptime/uptime-probe.ts";

export type { ParsedCron } from "./cron/cron-expression.ts";

class CronServiceClass {
	private readonly redeployScheduler = new DueScheduler<ServiceDTO>({
		describe: (svc) =>
			`cron redeploy: service=${svc.id} schedule="${svc.cronSchedule}"`,
		fire: (svc) =>
			DeploymentService.enqueueDeploy({
				svc,
				trigger: "cron",
				userId: svc.userId,
			}),
		label: "Cron",
		lastRunAt: (svc) => svc.cronLastRunAt,
		list: () => ServiceDTO.listCronEnabled(),
		markRun: (svc, now) => svc.update({ cronLastRunAt: now }),
		schedule: (svc) => svc.cronSchedule,
	});

	private readonly backupScheduler = new DueScheduler<StorageVolumeDTO>({
		describe: (volume) =>
			`scheduled backup: volume=${volume.id} schedule="${volume.backupSchedule}"`,
		fire: (volume) => enqueueVolumeBackup(volume),
		label: "Backup",
		lastRunAt: (volume) => volume.backupLastRunAt,
		list: () => StorageVolumeDTO.listBackupEnabled(),
		markRun: (volume, now) => volume.update({ backupLastRunAt: now }),
		schedule: (volume) => volume.backupSchedule,
	});

	private readonly cronJobScheduler = new DueScheduler<CronJobDTO>({
		describe: (job) => `cron job: job=${job.id} schedule="${job.schedule}"`,
		fire: (job) => enqueueCronJobRun(job),
		label: "Cron job",
		lastRunAt: (job) => job.lastRunAt,
		list: () => CronJobDTO.listEnabled(),
		markRun: (job, now) => job.update({ lastRunAt: now }),
		schedule: (job) => job.schedule,
	});

	private readonly statsSampler = new StatsSampler();

	private readonly uptimeProbe = new UptimeProbe();

	private readonly mirrorGcScheduler = new MirrorGcScheduler();

	private readonly gitPollScheduler = new GitPollScheduler();

	private readonly coreServicesWatch = new CoreServicesWatch();

	private readonly swarmDnsWatch = new SwarmDnsWatch();

	/** Parses a 5-field cron expression for schedule-input validation, see `cron-expression.ts`'s `parseCronSchedule`. */
	parseCronSchedule(schedule: string): ParsedCron | null {
		return parseCronSchedule(schedule);
	}

	/** Starts the per-service scheduled-redeploy scheduler (idempotent, HMR-safe, see `BaseScheduler.start`). */
	startCronScheduler(): void {
		this.redeployScheduler.start();
	}

	/** Starts the scheduled volume-backup scheduler. */
	startBackupScheduler(): void {
		this.backupScheduler.start();
	}

	/** Starts the user cron-job scheduler. */
	startCronJobScheduler(): void {
		this.cronJobScheduler.start();
	}

	/** Starts the per-minute stats sampler. */
	startStatsSampler(): void {
		this.statsSampler.start();
	}

	/** Starts the service uptime probe, quiet for `BOOT_QUIET_MS` while Homerun itself settles after a boot or an update. */
	startUptimeProbe(): void {
		quietUptimeProbes(BOOT_QUIET_MS);
		this.uptimeProbe.start();
	}

	/** Starts the daily mirror-registry garbage-collection scheduler. */
	startMirrorGcScheduler(): void {
		this.mirrorGcScheduler.start();
	}

	/** Starts the branch poller that deploys on push when a webhook can't be delivered. */
	startGitPollScheduler(): void {
		this.gitPollScheduler.start();
	}

	/** Starts the watch that re-asserts the core services every time the worker (re)starts. */
	startCoreServicesWatch(): void {
		this.coreServicesWatch.start();
	}

	/** Starts the watch that restarts a swarm service whose slug dropped out of Docker's DNS. */
	startSwarmDnsWatch(): void {
		this.swarmDnsWatch.start();
	}
}

export const CronService = new CronServiceClass();
