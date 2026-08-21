import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { S3BackupService } from "../s3-backup.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";
import { cronMatches, sameMinute } from "./cron-expression.ts";

/**
 * Opt-in, per-volume S3 backup scheduler (`storage/[volumeId]`'s
 * `backupEnabled` + `backupSchedule`). Mirrors CronRedeployScheduler's
 * shape exactly (same due-check / double-fire-guard pattern) but operates
 * on `StorageVolumeDTO` instead of `ServiceDTO`, independent scheduler,
 * not shared code, since the two DTOs don't otherwise relate.
 */
export class BackupScheduler extends BaseScheduler {
	protected readonly label = "Backup";

	private isDueNow(volume: StorageVolumeDTO, now: Date): boolean {
		const schedule = volume.backupSchedule;
		if (!(schedule && cronMatches(schedule, now))) {
			return false;
		}
		return !(volume.backupLastRunAt && sameMinute(volume.backupLastRunAt, now));
	}

	private async runBackup(volume: StorageVolumeDTO, now: Date): Promise<void> {
		this.logger.info(
			`Scheduled backup triggered: volume=${volume.id} schedule="${volume.backupSchedule}"`,
		);
		await volume.update({ backupLastRunAt: now });

		const result = await S3BackupService.backupVolume(volume);
		if (!result.success) {
			this.logger.error(
				`Scheduled backup failed: volume=${volume.id}`,
				result.error,
			);
		}
	}

	protected async tick(): Promise<void> {
		const now = new Date();
		const due = (await StorageVolumeDTO.listBackupEnabled()).filter((v) =>
			this.isDueNow(v, now),
		);

		await Promise.all(due.map((v) => this.runBackup(v, now)));
	}
}
