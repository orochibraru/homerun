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
import {
	cronMatches,
	type ParsedCron,
	parseCronSchedule,
} from "./cron/cron-expression.ts";
import { DueScheduler } from "./cron/due-scheduler.ts";
import { enqueueCronJobRun } from "./cron-job-queue.ts";
import { DeploymentService } from "./deploy.service.ts";

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

	parseCronSchedule(schedule: string): ParsedCron | null {
		return parseCronSchedule(schedule);
	}

	cronMatches(schedule: string, date: Date): boolean {
		return cronMatches(schedule, date);
	}

	startCronScheduler(): void {
		this.redeployScheduler.start();
	}

	startBackupScheduler(): void {
		this.backupScheduler.start();
	}

	startCronJobScheduler(): void {
		this.cronJobScheduler.start();
	}
}

export const CronService = new CronServiceClass();
