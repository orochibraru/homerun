import type { JobDTO } from "$lib/dto/job-dto";
import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { QueueService } from "./queue.service.ts";
import type { RestoreOptions } from "./s3-backup.service.ts";

/** Enqueues a backup job for `volume`, deduped and lock-scoped per volume so a second backup can't be queued (or run) while one is already pending. */
export function enqueueVolumeBackup(volume: StorageVolumeDTO): Promise<JobDTO> {
	return QueueService.enqueue({
		dedupeKey: `backup:${volume.id}`,
		lockKey: `volume:${volume.id}`,
		maxAttempts: 2,
		payload: { userId: volume.userId, volumeId: volume.id },
		title: `Back up ${volume.name}`,
		type: "backup",
		userId: volume.userId,
	});
}

/** Enqueues a restore of backup `key` into `volume`, sharing the per-volume lock with backups so a restore never runs while the same volume is being tarred, and never retried. */
export function enqueueVolumeRestore(
	volume: StorageVolumeDTO,
	key: string,
	options: RestoreOptions,
): Promise<JobDTO> {
	return QueueService.enqueue({
		dedupeKey: `restore:${volume.id}`,
		lockKey: `volume:${volume.id}`,
		maxAttempts: 1,
		payload: {
			key,
			stopServices: options.stopServices,
			userId: volume.userId,
			volumeId: volume.id,
			wipe: options.wipe,
		},
		title: `Restore ${volume.name}`,
		type: "backup_restore",
		userId: volume.userId,
	});
}
