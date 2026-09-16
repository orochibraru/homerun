import type { JobDTO } from "$lib/dto/job-dto";
import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { QueueService } from "./queue.service.ts";

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
