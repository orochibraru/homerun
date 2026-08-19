import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { backupVolume } from "$lib/server/backup/backup";
import { cronMatches } from "$lib/server/cron";

const logger = new Logger("Backup");
const TICK_MS = 60_000;

// Same HMR-safety pattern as cron-scheduler.ts / db/lib.ts's singleton.
const globalForBackup = globalThis as unknown as {
  __backup_interval?: ReturnType<typeof setInterval>;
};

function sameMinute(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

function isDueNow(volume: StorageVolumeDTO, now: Date): boolean {
  const schedule = volume.backupSchedule;
  if (!(schedule && cronMatches(schedule, now))) {
    return false;
  }
  return !(volume.backupLastRunAt && sameMinute(volume.backupLastRunAt, now));
}

async function runScheduledBackup(
  volume: StorageVolumeDTO,
  now: Date
): Promise<void> {
  logger.info(
    `Scheduled backup triggered: volume=${volume.id} schedule="${volume.backupSchedule}"`
  );
  await volume.update({ backupLastRunAt: now });

  const result = await backupVolume(volume);
  if (!result.success) {
    logger.error(`Scheduled backup failed: volume=${volume.id}`, result.error);
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  const due = (await StorageVolumeDTO.listBackupEnabled()).filter((v) =>
    isDueNow(v, now)
  );

  await Promise.all(due.map((v) => runScheduledBackup(v, now)));
}

/** Starts the once-a-minute scheduled-backup check. Idempotent — safe to call on every dev-server HMR reload. */
export function startBackupScheduler(): void {
  if (globalForBackup.__backup_interval) {
    return;
  }
  logger.info("Backup scheduler started (60s tick).");
  globalForBackup.__backup_interval = setInterval(() => {
    tick().catch((err) => logger.error("Backup tick failed", err));
  }, TICK_MS);
}
