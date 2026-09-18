import type { JobType } from "$lib/types";
import { backupWorkerJob } from "./backup.ts";
import { backupRestoreWorkerJob } from "./backup_restore.ts";
import { cronJobWorkerJob } from "./cron_job.ts";
import { deployWorkerJob } from "./deploy.ts";
import { dockerCleanupWorkerJob } from "./docker_cleanup.ts";
import { imageScanWorkerJob } from "./image_scan.ts";
import type { WorkerJob } from "./types.ts";

export type { WorkerJob } from "./types.ts";

export const workerJobs: Record<JobType, WorkerJob | null> = {
	backup: backupWorkerJob,
	backup_restore: backupRestoreWorkerJob,
	cron_job: cronJobWorkerJob,
	deploy: deployWorkerJob,
	docker_cleanup: dockerCleanupWorkerJob,
	image_scan: imageScanWorkerJob,
	notification_delivery: null,
};
